"""Power / progressive dialer for the wholesaling-swarm.

ONE live outbound leg per agent at a time. For a multi-number owner, dial numbers
sequentially in priority order; stop at first human; auto-advance on any non-human
terminal. AMD silently skips voicemail/machine. Zero abandonment — no parallel
origination, no race, no sibling teardown.

This module is the Python/Twilio/SQLite translation of the authoritative spec.
Carrier access is behind CarrierAdapter (PD-2); this file is PD-1: the data model.

Data-model note (spec §4): the spec's `phone_numbers` entity maps onto the existing
`owner_phones` table (already the per-number entity) — we extend it with dial state
rather than duplicate it. Per-number granularity is load-bearing: retry, disable,
and cadence live on the number, never on the lead. Lead status is a reduction over
its numbers.
"""
from __future__ import annotations

import sqlite3

# ── Per-number dial-state columns added to owner_phones (spec §4 phone_numbers) ──
# name -> column definition (SQLite). Added idempotently via ALTER TABLE.
# ── Lead-level dial columns (spec §4 leads.priority / next_action_at). The lead
# status reuses the existing `leads.status`; the power dialer adds its own queue
# priority + next-action time so its cadence never collides with other status use. ──
_LEADS_DIAL_COLUMNS: dict[str, str] = {
    "pd_priority": "INTEGER NOT NULL DEFAULT 100",   # queue order; lower dials first
    "pd_next_action_at": "TEXT",                     # min(next_eligible_at) over numbers
    "pd_attempt_count": "INTEGER NOT NULL DEFAULT 0",  # dial passes (spec §10)
}

_OWNER_PHONE_DIAL_COLUMNS: dict[str, str] = {
    "npa": "TEXT",                              # area code, derived from phone_digits
    "tz": "TEXT",                               # IANA tz from NPA (§9.4) — NOT mailing addr
    "dial_priority": "INTEGER NOT NULL DEFAULT 100",  # WITHIN-lead order; lower dials first
    "dial_disabled": "INTEGER NOT NULL DEFAULT 0",     # exhausted/failed-out number
    "dial_attempt_count": "INTEGER NOT NULL DEFAULT 0",
    "last_result": "TEXT",                      # last terminal (§5.1)
    "last_attempt_at": "TEXT",
    "next_eligible_at": "TEXT",                 # per-number backoff (§10)
    "last_daypart": "TEXT",                     # morning|midday|evening of last no_answer
}

# ── New orchestration tables (spec §4). SQLite: UUID→TEXT, TIMESTAMPTZ→TEXT(ISO). ──
_SCHEMA_STATEMENTS: list[str] = [
    # ONE ROW PER DIAL, connected or not (spec §4 call_legs)
    """
    CREATE TABLE IF NOT EXISTS pd_call_legs (
        id                TEXT PRIMARY KEY,
        lead_id           TEXT NOT NULL,
        owner_phone_id    INTEGER NOT NULL,     -- FK owner_phones.id (spec: phone_number_id)
        agent_id          TEXT NOT NULL,
        carrier_call_id   TEXT,                 -- Twilio Call SID
        from_did          TEXT,                 -- caller ID used
        state             TEXT NOT NULL,        -- leg state machine (§5.1)
        connect_mode      TEXT NOT NULL,        -- amd_screen | live_bridge
        detection_result  TEXT,                 -- human|machine|ivr|unknown (amd_screen)
        answered_at       TEXT,
        bridged_at        TEXT,
        sip_cause         TEXT,
        started_at        TEXT NOT NULL,
        ended_at          TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_pd_call_legs_state ON pd_call_legs(state)",
    "CREATE INDEX IF NOT EXISTS idx_pd_call_legs_carrier ON pd_call_legs(carrier_call_id)",
    # ONLY created on a live-human connect (spec §4 conversations)
    """
    CREATE TABLE IF NOT EXISTS pd_conversations (
        id           TEXT PRIMARY KEY,
        leg_id       TEXT NOT NULL,
        lead_id      TEXT NOT NULL,
        agent_id     TEXT NOT NULL,
        started_at   TEXT NOT NULL,
        ended_at     TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pd_dispositions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  TEXT,                  -- null for system no_human
        lead_id          TEXT NOT NULL,
        code             TEXT NOT NULL,         -- §11
        notes            TEXT,
        callback_at      TEXT,
        dnc_request      INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL
    )
    """,
    # dial-time suppression (spec §4 suppressions) — federal/internal DNC, litigator, wrong#
    """
    CREATE TABLE IF NOT EXISTS pd_suppressions (
        e164        TEXT PRIMARY KEY,
        reason      TEXT NOT NULL,             -- federal_dnc|internal_dnc|wrong_number|litigator
        added_at    TEXT NOT NULL
    )
    """,
    # append-only, immutable (spec §14)
    """
    CREATE TABLE IF NOT EXISTS pd_audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id     TEXT,
        leg_id      TEXT,
        entity      TEXT,
        event       TEXT,
        detail      TEXT,                      -- JSON
        at          TEXT NOT NULL
    )
    """,
    # NANPA NPA → IANA timezone (spec §9.4). Seeded below; extendable seam.
    """
    CREATE TABLE IF NOT EXISTS pd_npa_tz (
        npa    CHAR(3) PRIMARY KEY,
        tz     TEXT NOT NULL,
        state  TEXT
    )
    """,
    # Owned caller-ID DIDs for local-presence rotation (PD-7). Synced from the
    # carrier's owned numbers on startup; select_caller_id rotates over this by
    # matching the DIALED number's area code (then same state, then default).
    """
    CREATE TABLE IF NOT EXISTS pd_did_pool (
        e164      TEXT PRIMARY KEY,
        npa       TEXT,
        state     TEXT,
        active    INTEGER NOT NULL DEFAULT 1,
        added_at  TEXT
    )
    """,
]

# ── NPA → IANA tz seed. Thorough for active markets (FL/TX/OH); broad national
# coverage otherwise. Calling-window compliance (§9.4) derives tz from the DIALED
# number's NPA, so accuracy here is load-bearing. Extend as new markets open. ──
_NPA_TZ_SEED: dict[str, str] = {
    # Florida — America/New_York (all FL NPAs are Eastern)
    **{npa: "America/New_York" for npa in (
        "239", "305", "321", "324", "352", "386", "407", "448", "561", "645",
        "656", "689", "727", "728", "754", "772", "786", "813", "820", "850",
        "863", "904", "941", "954",
    )},
    # Texas — mostly America/Chicago; 915 (El Paso) is Mountain
    **{npa: "America/Chicago" for npa in (
        "210", "214", "254", "281", "325", "346", "361", "409", "430", "432",
        "469", "512", "682", "713", "726", "737", "806", "817", "830", "832",
        "903", "936", "940", "945", "956", "972", "979",
    )},
    "915": "America/Denver",
    # Ohio — America/New_York (all OH NPAs are Eastern)
    **{npa: "America/New_York" for npa in (
        "216", "220", "234", "283", "326", "330", "380", "419", "436", "440",
        "513", "567", "614", "740", "937",
    )},
    # Representative national coverage (other markets you may open)
    "212": "America/New_York", "312": "America/Chicago", "303": "America/Denver",
    "213": "America/Los_Angeles", "404": "America/New_York", "702": "America/Los_Angeles",
    "602": "America/Phoenix", "206": "America/Los_Angeles", "615": "America/Chicago",
    "704": "America/New_York", "801": "America/Denver", "505": "America/Denver",
}

# Conservative fallback when an NPA isn't mapped: Eastern gives the EARLIEST close
# (21:00 ET), so a window check that can't resolve tz errs toward NOT dialing late.
_DEFAULT_TZ = "America/New_York"

# NPA → USPS state, for same-state caller-ID fallback (PD-7 local presence). Covers
# the active markets; extend alongside _NPA_TZ_SEED as new markets open.
_NPA_STATE_SEED: dict[str, str] = {
    **{npa: "FL" for npa in (
        "239", "305", "321", "324", "352", "386", "407", "448", "561", "645",
        "656", "689", "727", "728", "754", "772", "786", "813", "820", "850",
        "863", "904", "941", "954")},
    **{npa: "TX" for npa in (
        "210", "214", "254", "281", "325", "346", "361", "409", "430", "432",
        "469", "512", "682", "713", "726", "737", "806", "817", "830", "832",
        "903", "915", "936", "940", "945", "956", "972", "979")},
    **{npa: "OH" for npa in (
        "216", "220", "234", "283", "326", "330", "380", "419", "436", "440",
        "513", "567", "614", "740", "937")},
    "212": "NY", "312": "IL", "303": "CO", "213": "CA", "404": "GA", "702": "NV",
    "602": "AZ", "206": "WA", "615": "TN", "704": "NC", "801": "UT", "505": "NM",
}


def _existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def ensure_schema(conn: sqlite3.Connection) -> dict[str, int]:
    """Idempotently create power-dialer tables, extend owner_phones with dial state,
    and seed the NPA→tz table. Safe to run on every startup. Returns a small summary."""
    added_cols = 0
    existing = _existing_columns(conn, "owner_phones")
    for name, ddl in _OWNER_PHONE_DIAL_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE owner_phones ADD COLUMN {name} {ddl}")
            added_cols += 1

    lead_existing = _existing_columns(conn, "leads")
    for name, ddl in _LEADS_DIAL_COLUMNS.items():
        if name not in lead_existing:
            conn.execute(f"ALTER TABLE leads ADD COLUMN {name} {ddl}")
            added_cols += 1
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_pd_queue ON leads(status, pd_next_action_at)")

    for stmt in _SCHEMA_STATEMENTS:
        conn.execute(stmt)

    # pd_npa_tz gained a `state` column (PD-7 local-presence fallback) after first
    # ship — add it idempotently for pre-existing DBs.
    if "state" not in _existing_columns(conn, "pd_npa_tz"):
        conn.execute("ALTER TABLE pd_npa_tz ADD COLUMN state TEXT")
        added_cols += 1

    # Helpful indexes for the dial loop's hot paths.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_owner_phones_owner ON owner_phones(owner_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_owner_phones_next_eligible "
        "ON owner_phones(next_eligible_at)"
    )

    seeded = 0
    for npa, tz in _NPA_TZ_SEED.items():
        cur = conn.execute(
            "INSERT OR IGNORE INTO pd_npa_tz (npa, tz) VALUES (?, ?)", (npa, tz)
        )
        seeded += cur.rowcount
    # Backfill state for every seeded NPA (also fixes rows inserted before the
    # `state` column existed).
    for npa, state in _NPA_STATE_SEED.items():
        conn.execute("UPDATE pd_npa_tz SET state = ? WHERE npa = ? AND state IS NULL", (state, npa))

    conn.commit()
    return {"columns_added": added_cols, "npa_seeded": seeded}


def state_for_npa(conn: sqlite3.Connection, npa: str | None) -> str | None:
    """Resolve NPA → USPS state for same-state caller-ID fallback (PD-7)."""
    if not npa:
        return None
    row = conn.execute("SELECT state FROM pd_npa_tz WHERE npa = ?", (npa,)).fetchone()
    if row and row[0]:
        return row[0]
    return _NPA_STATE_SEED.get(npa)


def tz_for_npa(conn: sqlite3.Connection, npa: str | None) -> str:
    """Resolve NPA → IANA tz (spec §9.4), conservative default if unknown."""
    if npa:
        row = conn.execute("SELECT tz FROM pd_npa_tz WHERE npa = ?", (npa,)).fetchone()
        if row:
            return row[0]
    return _DEFAULT_TZ
