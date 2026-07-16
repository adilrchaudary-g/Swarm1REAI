"""Power-dialer orchestrator (spec §7–§11).

One worker thread per agent. The defining invariant (§9.1): at most ONE in-flight
originate per agent at any instant — enforced structurally by blocking on the leg's
terminal before the next dial. That is what makes abandonment impossible: a warm
agent is always present and free for every call placed on their line.

Threading model (Python translation of the spec's async loop):
  - agent worker thread runs _run_agent_loop
  - Twilio webhooks (HTTP handler threads) call handle_answer/handle_amd/handle_status,
    which resolve the in-flight leg via a per-leg threading.Event
  - _dial_one blocks on that Event → the one-leg invariant holds by construction
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
import re
from datetime import datetime, timedelta, timezone

from .carrier import CarrierAdapter

# ── Config (spec §13) ────────────────────────────────────────────
CONNECT_MODE = "amd_screen"      # amd_screen | live_bridge
AMD_MAX_WAIT_S = 4.0             # answered but no AMD verdict by this → treat human + bridge
RING_TIMEOUT_S = 22             # cap ring before no_answer
LEG_HARD_TIMEOUT_S = RING_TIMEOUT_S + 15  # never wedge the loop (§9.2)
WRAP_UP_MAX_S = 600             # max wait for an agent disposition before defaulting
# per-number backoff (§10), seconds
BUSY_BACKOFF_S = 20 * 60
NA_BACKOFF_S = 4 * 3600
MACHINE_BACKOFF_S = 24 * 3600
MACHINE_MAX = 3
FAIL_BACKOFF_S = 3600
FAIL_MAX = 3
MAX_LEAD_ATTEMPTS = 12
DAYPARTS = ["morning", "midday", "evening"]

# Twilio rate estimates for the metrics cost line (§14). Adjust to your account's
# actual rates. Outbound US termination + AMD add-on fee per call.
_RATE_OUTBOUND_PER_MIN = 0.014
_FEE_AMD_PER_CALL = 0.0075

_HUMAN = "human"
_NONHUMAN_TERMINALS = {"machine", "ivr", "no_answer", "busy", "failed"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _to_e164(digits_or_value: str) -> str | None:
    d = re.sub(r"\D", "", digits_or_value or "")
    if len(d) == 10:
        return f"+1{d}"
    if len(d) == 11 and d.startswith("1"):
        return f"+{d}"
    if (digits_or_value or "").startswith("+") and len(d) >= 11:
        return f"+{d}"
    return None


def _daypart(dt: datetime) -> str:
    h = dt.hour
    return "morning" if h < 12 else "midday" if h < 17 else "evening"


class PowerDialer:
    def __init__(self, db_path: str, adapter: CarrierAdapter) -> None:
        self.db_path = db_path
        self.adapter = adapter
        self._legs: dict[str, dict] = {}
        self._legs_lock = threading.Lock()
        self._db_lock = threading.Lock()           # serialize SQLite writes
        self._active: dict[str, bool] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._conf: dict[str, str] = {}
        self._dispo: dict[str, dict] = {}           # agent_id -> {lead_id, event, result}

    def recover_orphans(self) -> dict:
        """Spec §12: on startup, in-flight legs are dead (process restarted) — mark
        non-terminal legs failed, and return any lead stuck 'dialing' to 'queued'."""
        now = _iso(_now())
        with self._db_lock:
            conn = self._conn()
            try:
                legs = conn.execute(
                    "SELECT id, carrier_call_id FROM pd_call_legs "
                    "WHERE state IN ('dialing','ringing','screening','answered')").fetchall()
                for leg in legs:
                    if leg["carrier_call_id"]:
                        try:
                            self.adapter.hangup(leg["carrier_call_id"])
                        except Exception:
                            pass
                    conn.execute("UPDATE pd_call_legs SET state='failed', ended_at=? WHERE id=?",
                                 (now, leg["id"]))
                stuck = conn.execute("SELECT COUNT(*) c FROM leads WHERE status='dialing'").fetchone()["c"]
                conn.execute("UPDATE leads SET status='queued', updated_at=? WHERE status='dialing'", (now,))
                conn.commit()
                return {"legs_failed": len(legs), "leads_requeued": stuck}
            finally:
                conn.close()

    # ── DB helpers ───────────────────────────────────────────────
    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _audit(self, conn, *, lead_id=None, leg_id=None, entity=None, event=None, detail=None):
        conn.execute(
            "INSERT INTO pd_audit_log (lead_id, leg_id, entity, event, detail, at) VALUES (?,?,?,?,?,?)",
            (lead_id, leg_id, entity, event, json.dumps(detail) if detail else None, _iso(_now())))

    # ── PD-3: single dial → screen → terminal ────────────────────
    def _resolve(self, leg_ref: str, outcome: str) -> None:
        """Mark the in-flight leg's terminal exactly once and wake its worker."""
        with self._legs_lock:
            reg = self._legs.get(leg_ref)
            if not reg or reg["outcome"] is not None:
                return
            reg["outcome"] = outcome
            t = reg.get("amd_timer")
            if t:
                t.cancel()
            reg["event"].set()

    # webhook: lead answered — park it (hold) and start the AMD-patience timer
    def handle_answer(self, leg_ref: str) -> str:
        with self._legs_lock:
            reg = self._legs.get(leg_ref)
            if reg and not reg["answered"]:
                reg["answered"] = True
                if CONNECT_MODE == "amd_screen":
                    # answered, no AMD verdict within AMD_MAX_WAIT_S → treat human + bridge
                    timer = threading.Timer(AMD_MAX_WAIT_S, self._resolve, args=(leg_ref, _HUMAN))
                    timer.daemon = True
                    reg["amd_timer"] = timer
                    timer.start()
                else:  # live_bridge: answered == human, agent already on the leg
                    self._resolve(leg_ref, _HUMAN)
        # Hold the lead silently until we bridge (human) or hang up (machine).
        return ('<?xml version="1.0" encoding="UTF-8"?>'
                '<Response><Pause length="30"/></Response>')

    # webhook: async AMD verdict
    def handle_amd(self, leg_ref: str, answered_by: str | None) -> None:
        a = (answered_by or "").lower()
        if a == "human":
            self._resolve(leg_ref, _HUMAN)
        elif a.startswith("machine"):
            self._resolve(leg_ref, "machine")
        elif a == "fax":
            self._resolve(leg_ref, "machine")
        elif a in ("unknown", ""):
            # ambiguous: strict — treat as machine so the agent never hears a robot
            self._resolve(leg_ref, "machine")
        else:
            self._resolve(leg_ref, "machine")

    # webhook: terminal call status for an UNanswered (or ended) leg
    def handle_status(self, leg_ref: str, call_status: str, duration_sec: int = 0) -> None:
        cs = (call_status or "").lower()
        if cs in ("no-answer", "no_answer"):
            self._resolve(leg_ref, "no_answer")
        elif cs == "busy":
            self._resolve(leg_ref, "busy")
        elif cs in ("failed", "canceled", "cancelled"):
            self._resolve(leg_ref, "failed")
        elif cs == "completed":
            # If the leg never resolved (answered but nothing bridged), fall back.
            with self._legs_lock:
                reg = self._legs.get(leg_ref)
                unresolved = reg and reg["outcome"] is None and not reg["answered"]
            if unresolved:
                self._resolve(leg_ref, "no_answer")

    def agent_join_twiml(self, conf: str) -> str:
        esc = (conf.replace("&", "&amp;").replace("<", "&lt;")
               .replace(">", "&gt;").replace('"', "&quot;"))
        return ('<?xml version="1.0" encoding="UTF-8"?>'
                '<Response><Dial><Conference startConferenceOnEnter="true" '
                'endConferenceOnExit="true" beep="false" '
                f'waitUrl="">{esc}</Conference></Dial></Response>')

    def sync_did_pool(self) -> int:
        """Discover the carrier's owned DIDs and upsert them into pd_did_pool so
        select_caller_id can rotate caller ID by area code (PD-7 local presence).
        Best-effort — safe to call on startup; returns the DID count."""
        try:
            numbers = self.adapter.list_owned_numbers()
        except Exception:
            numbers = []
        if not numbers:
            return 0
        from .power_dialer import state_for_npa
        now = _iso(_now())
        with self._db_lock:
            conn = self._conn()
            try:
                for e164 in numbers:
                    digits = re.sub(r"\D", "", e164 or "")
                    npa = digits[-10:-7] if len(digits) >= 10 else None
                    state = state_for_npa(conn, npa)
                    # Preserve a DID's active flag across re-syncs; only refresh npa/state.
                    conn.execute(
                        "INSERT OR IGNORE INTO pd_did_pool (e164, npa, state, active, added_at) "
                        "VALUES (?,?,?,1,?)", (e164, npa, state, now))
                    conn.execute("UPDATE pd_did_pool SET npa=?, state=? WHERE e164=?",
                                 (npa, state, e164))
                conn.commit()
            finally:
                conn.close()
        return len(numbers)

    def select_caller_id(self, number_row: sqlite3.Row) -> str:
        """Local-presence rotation (PD-7): prefer a DID in the DIALED number's area
        code, then one in the same state, else the default DID. Random among equals
        so one NPA's calls spread across all matching owned DIDs. Falls back to the
        env DID whenever the pool is empty (i.e. current single-number setup)."""
        import os
        import random
        default = os.environ.get("TWILIO_PHONE_NUMBER", "").strip()
        e164 = _to_e164(number_row["phone_value"] or number_row["phone_digits"])
        if not e164:
            return default
        keys = number_row.keys()
        npa = (number_row["npa"] if "npa" in keys and number_row["npa"]
               else re.sub(r"\D", "", e164)[-10:-7])
        if not npa:
            return default
        conn = self._conn()
        try:
            exact = conn.execute(
                "SELECT e164 FROM pd_did_pool WHERE active=1 AND npa=?", (npa,)).fetchall()
            if exact:
                return random.choice(exact)[0]
            from .power_dialer import state_for_npa
            st = state_for_npa(conn, npa)
            if st:
                same = conn.execute(
                    "SELECT e164 FROM pd_did_pool WHERE active=1 AND state=?", (st,)).fetchall()
                if same:
                    return random.choice(same)[0]
        finally:
            conn.close()
        return default

    def _dial_one(self, lead_id: str, number: sqlite3.Row, agent_id: str, conf: str) -> tuple[str, str]:
        """Fire ONE leg, block until terminal, do the carrier side effects. Returns
        (outcome, leg_ref). The blocking wait IS the one-leg invariant (§9.1)."""
        leg_ref = uuid.uuid4().hex
        e164 = _to_e164(number["phone_value"] or number["phone_digits"])
        if not e164:
            return "failed", leg_ref
        from_did = self.select_caller_id(number)
        event = threading.Event()
        with self._legs_lock:
            self._legs[leg_ref] = {"event": event, "outcome": None, "sid": None,
                                   "answered": False, "amd_timer": None}
        sid = self.adapter.originate(
            to=e164, from_did=from_did, agent_id=agent_id,
            amd=(CONNECT_MODE == "amd_screen"), ring_timeout_s=RING_TIMEOUT_S, leg_ref=leg_ref)
        if not sid:
            with self._legs_lock:
                self._legs.pop(leg_ref, None)
            self._insert_leg(leg_ref, lead_id, number["id"], agent_id, None, from_did, "failed")
            return "failed", leg_ref
        with self._legs_lock:
            if leg_ref in self._legs:
                self._legs[leg_ref]["sid"] = sid
        self._insert_leg(leg_ref, lead_id, number["id"], agent_id, sid, from_did, "dialing")

        event.wait(timeout=LEG_HARD_TIMEOUT_S)
        with self._legs_lock:
            reg = self._legs.get(leg_ref, {})
            outcome = reg.get("outcome") or "failed"     # timeout → failed (never wedge)
            t = reg.get("amd_timer")
            if t:
                t.cancel()

        if outcome == _HUMAN:
            if not self.adapter.bridge_to_conference(sid, conf):
                self.adapter.hangup(sid)
                outcome = "failed"
        else:
            self.adapter.hangup(sid)                      # idempotent; ends machine/parked leg

        with self._legs_lock:
            self._legs.pop(leg_ref, None)
        self._finalize_leg(leg_ref, outcome)
        return outcome, leg_ref

    # ── leg persistence ──────────────────────────────────────────
    def _insert_leg(self, leg_ref, lead_id, phone_id, agent_id, sid, from_did, state):
        with self._db_lock:
            conn = self._conn()
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO pd_call_legs
                       (id, lead_id, owner_phone_id, agent_id, carrier_call_id, from_did,
                        state, connect_mode, started_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (leg_ref, lead_id, phone_id, agent_id, sid, from_did, state,
                     CONNECT_MODE, _iso(_now())))
                conn.commit()
            finally:
                conn.close()

    def _finalize_leg(self, leg_ref, outcome):
        with self._db_lock:
            conn = self._conn()
            try:
                conn.execute(
                    "UPDATE pd_call_legs SET state=?, detection_result=?, ended_at=? WHERE id=?",
                    (outcome, outcome if outcome in ("machine", "human") else None,
                     _iso(_now()), leg_ref))
                conn.commit()
            finally:
                conn.close()

    # ── PD-4: the agent loop ─────────────────────────────────────
    def start_agent(self, agent_id: str) -> None:
        if self._active.get(agent_id):
            return
        self._active[agent_id] = True
        t = threading.Thread(target=self._run_agent_loop, args=(agent_id,), daemon=True)
        self._workers[agent_id] = t
        t.start()

    def stop_agent(self, agent_id: str) -> None:
        self._active[agent_id] = False

    def _run_agent_loop(self, agent_id: str) -> None:
        conf = self.adapter.create_conference(agent_id)
        self._conf[agent_id] = conf
        self.adapter.join_agent(agent_id, conf)          # warm agent, once (§7)
        while self._active.get(agent_id):
            lead = self.claim_next_lead(agent_id)
            if not lead:
                time.sleep(2)
                continue
            lead_id = lead["lead_id"]
            connected = False
            for number in self.dialable_numbers(lead_id):   # sequential, best first (§9)
                if not self._active.get(agent_id):
                    break
                outcome, leg_ref = self._dial_one(lead_id, number, agent_id, conf)
                self._record_terminal_cadence(number, outcome)
                if outcome == _HUMAN:
                    conv_id = self._open_conversation(leg_ref, lead_id, agent_id)
                    self._set_lead_status(lead_id, "connected")
                    dispo = self._await_disposition(agent_id, lead_id)
                    self._apply_disposition(lead_id, number, conv_id, dispo)
                    connected = True
                    break                                    # stop dialing this owner (§9)
            if not connected:
                self._exhaust_lead(lead_id)

    def claim_next_lead(self, agent_id: str) -> dict | None:
        now = _iso(_now())
        with self._db_lock:
            conn = self._conn()
            try:
                row = conn.execute(
                    """SELECT lead_id FROM leads
                       WHERE status='queued' AND (pd_next_action_at IS NULL OR pd_next_action_at<=?)
                       ORDER BY pd_priority ASC, pd_next_action_at ASC LIMIT 1""", (now,)).fetchone()
                if not row:
                    return None
                conn.execute("UPDATE leads SET status='dialing', updated_at=? WHERE lead_id=?",
                             (now, row["lead_id"]))
                self._audit(conn, lead_id=row["lead_id"], entity="lead", event="claimed",
                            detail={"agent": agent_id})
                conn.commit()
                return {"lead_id": row["lead_id"]}
            finally:
                conn.close()


    def dialable_numbers(self, lead_id: str) -> list[sqlite3.Row]:
        """Dial-set filter, applied EVERY pass (§9.3): not disabled/bad/DNC, is a cell,
        past its backoff, and NOT suppressed. (Calling-window gate removed per operator.)"""
        now = _iso(_now())
        conn = self._conn()
        try:
            candidates = conn.execute(
                """SELECT op.* FROM owner_phones op
                   JOIN leads l ON l.owner_id = op.owner_id
                   WHERE l.lead_id = ?
                     AND COALESCE(op.dial_disabled,0)=0
                     AND COALESCE(op.bad_number,0)=0
                     AND COALESCE(op.dnc,0)=0
                     AND LOWER(op.phone_type) IN ('cell','mobile')
                     AND (op.next_eligible_at IS NULL OR op.next_eligible_at<=?)
                   ORDER BY COALESCE(op.dial_priority,100) ASC, op.id ASC""",
                (lead_id, now)).fetchall()
            out = []
            for row in candidates:
                e164 = _to_e164(row["phone_value"] or row["phone_digits"])
                if not e164:
                    continue
                if conn.execute("SELECT 1 FROM pd_suppressions WHERE e164=?", (e164,)).fetchone():
                    continue                                  # §9.7 dial-time DNC/suppression
                out.append(row)
            return out
        finally:
            conn.close()

    # ── cadence (§10) ────────────────────────────────────────────
    def _record_terminal_cadence(self, number: sqlite3.Row, outcome: str) -> None:
        if outcome == _HUMAN:
            return  # counters reset on disposition path
        now = _now()
        updates = {"last_result": outcome, "last_attempt_at": _iso(now),
                   "dial_attempt_count": (number["dial_attempt_count"] or 0) + 1}
        disabled = 0
        if outcome == "busy":
            updates["next_eligible_at"] = _iso(now + timedelta(seconds=BUSY_BACKOFF_S))
        elif outcome == "no_answer":
            updates["next_eligible_at"] = _iso(now + timedelta(seconds=NA_BACKOFF_S))
            updates["last_daypart"] = _daypart(now)         # daypart rotation lever (§10)
        elif outcome in ("machine", "ivr"):
            updates["next_eligible_at"] = _iso(now + timedelta(seconds=MACHINE_BACKOFF_S))
            if updates["dial_attempt_count"] >= MACHINE_MAX:
                disabled = 1
        elif outcome == "failed":
            updates["next_eligible_at"] = _iso(now + timedelta(seconds=FAIL_BACKOFF_S))
            if updates["dial_attempt_count"] >= FAIL_MAX:
                disabled = 1
        updates["dial_disabled"] = disabled
        with self._db_lock:
            conn = self._conn()
            try:
                cols = ", ".join(f"{k}=?" for k in updates)
                conn.execute(f"UPDATE owner_phones SET {cols} WHERE id=?",
                             (*updates.values(), number["id"]))
                conn.commit()
            finally:
                conn.close()

    def _exhaust_lead(self, lead_id: str) -> None:
        """All this-pass numbers terminal, none human → re-queue at min next_eligible,
        or mark dead when nothing dialable remains / max passes hit (§5.2, §10)."""
        now = _now()
        with self._db_lock:
            conn = self._conn()
            try:
                passes = (conn.execute("SELECT COALESCE(pd_attempt_count,0) c FROM leads WHERE lead_id=?",
                                       (lead_id,)).fetchone()["c"]) + 1
                row = conn.execute(
                    """SELECT MIN(op.next_eligible_at) nxt FROM owner_phones op
                       JOIN leads l ON l.owner_id=op.owner_id
                       WHERE l.lead_id=? AND COALESCE(op.dial_disabled,0)=0
                         AND COALESCE(op.bad_number,0)=0 AND COALESCE(op.dnc,0)=0
                         AND LOWER(op.phone_type) IN ('cell','mobile')""", (lead_id,)).fetchone()
                nxt = row["nxt"] if row else None
                if nxt is None or passes >= MAX_LEAD_ATTEMPTS:
                    conn.execute("UPDATE leads SET status='dead', pd_attempt_count=?, updated_at=? WHERE lead_id=?",
                                 (passes, _iso(now), lead_id))
                    self._audit(conn, lead_id=lead_id, entity="lead", event="dead",
                                detail={"passes": passes})
                else:
                    conn.execute("""UPDATE leads SET status='queued', pd_next_action_at=?,
                                    pd_attempt_count=?, updated_at=? WHERE lead_id=?""",
                                 (nxt, passes, _iso(now), lead_id))
                    self._audit(conn, lead_id=lead_id, entity="lead", event="exhausted_requeued",
                                detail={"next": nxt, "passes": passes})
                conn.commit()
            finally:
                conn.close()

    # ── conversation + disposition (§11) ─────────────────────────
    def _open_conversation(self, leg_ref: str, lead_id: str, agent_id: str) -> str:
        conv_id = uuid.uuid4().hex
        with self._db_lock:
            conn = self._conn()
            try:
                conn.execute("""INSERT INTO pd_conversations (id, leg_id, lead_id, agent_id, started_at)
                                VALUES (?,?,?,?,?)""", (conv_id, leg_ref, lead_id, agent_id, _iso(_now())))
                conn.execute("UPDATE pd_call_legs SET bridged_at=? WHERE id=?", (_iso(_now()), leg_ref))
                self._audit(conn, lead_id=lead_id, leg_id=leg_ref, entity="conversation", event="opened")
                conn.commit()
            finally:
                conn.close()
        return conv_id

    def submit_disposition(self, agent_id: str, code: str, notes: str | None = None,
                           callback_at: str | None = None, dnc_request: bool = False) -> bool:
        slot = self._dispo.get(agent_id)
        if not slot:
            return False
        slot["result"] = {"code": code, "notes": notes, "callback_at": callback_at,
                          "dnc_request": dnc_request}
        slot["event"].set()
        return True

    def _await_disposition(self, agent_id: str, lead_id: str) -> dict:
        ev = threading.Event()
        self._dispo[agent_id] = {"lead_id": lead_id, "event": ev, "result": None}
        ev.wait(timeout=WRAP_UP_MAX_S)
        slot = self._dispo.pop(agent_id, {})
        return slot.get("result") or {"code": "contact_made", "notes": "auto (wrap-up timeout)"}

    def _apply_disposition(self, lead_id: str, number: sqlite3.Row, conv_id: str, dispo: dict) -> None:
        now = _now()
        code = dispo.get("code", "contact_made")
        with self._db_lock:
            conn = self._conn()
            try:
                conn.execute("UPDATE pd_conversations SET ended_at=? WHERE id=?", (_iso(now), conv_id))
                conn.execute("""INSERT INTO pd_dispositions
                                (conversation_id, lead_id, code, notes, callback_at, dnc_request, created_at)
                                VALUES (?,?,?,?,?,?,?)""",
                             (conv_id, lead_id, code, dispo.get("notes"), dispo.get("callback_at"),
                              1 if dispo.get("dnc_request") else 0, _iso(now)))
                # this number's counters reset on human contact (§10)
                conn.execute("UPDATE owner_phones SET last_result='human', dial_attempt_count=0, last_attempt_at=? WHERE id=?",
                             (_iso(now), number["id"]))
                e164 = _to_e164(number["phone_value"] or number["phone_digits"])
                if code == "wrong_number":
                    conn.execute("UPDATE owner_phones SET dial_disabled=1 WHERE id=?", (number["id"],))
                    if e164:
                        conn.execute("INSERT OR IGNORE INTO pd_suppressions (e164, reason, added_at) VALUES (?, 'wrong_number', ?)", (e164, _iso(now)))
                    conn.execute("UPDATE leads SET status='queued', updated_at=? WHERE lead_id=?", (_iso(now), lead_id))
                elif code == "dnc_request" or dispo.get("dnc_request"):
                    if e164:
                        conn.execute("INSERT OR IGNORE INTO pd_suppressions (e164, reason, added_at) VALUES (?, 'internal_dnc', ?)", (e164, _iso(now)))
                    conn.execute("UPDATE leads SET status='dead', updated_at=? WHERE lead_id=?", (_iso(now), lead_id))
                elif code == "callback":
                    conn.execute("UPDATE leads SET status='queued', pd_next_action_at=?, updated_at=? WHERE lead_id=?",
                                 (dispo.get("callback_at") or _iso(now + timedelta(hours=4)), _iso(now), lead_id))
                elif code == "not_interested":
                    conn.execute("UPDATE leads SET status='not_interested', updated_at=? WHERE lead_id=?", (_iso(now), lead_id))
                else:  # contact_made / interested / other → keep in play
                    new_status = "interested" if code == "interested" else "contacted"
                    conn.execute("UPDATE leads SET status=?, updated_at=? WHERE lead_id=?", (new_status, _iso(now), lead_id))
                self._audit(conn, lead_id=lead_id, entity="disposition", event=code)
                conn.commit()
            finally:
                conn.close()

    def agent_state(self, agent_id: str) -> dict:
        """Lightweight state for the UI to poll: active, and if a live human is on
        the line (agent in wrap-up), the connected lead + its display fields."""
        slot = self._dispo.get(agent_id)
        connected = None
        if slot:
            conn = self._conn()
            try:
                row = conn.execute(
                    """SELECT l.lead_id, o.owner_name, p.address_full, l.mao,
                              l.persona_primary, l.motivation_tier, l.motivation_score
                       FROM leads l
                       LEFT JOIN owners o ON o.owner_id=l.owner_id
                       LEFT JOIN properties p ON p.property_id=l.property_id
                       WHERE l.lead_id=?""", (slot["lead_id"],)).fetchone()
                if row:
                    connected = dict(row)
            finally:
                conn.close()
        return {
            "active": bool(self._active.get(agent_id)),
            "status": "connected" if slot else ("active" if self._active.get(agent_id) else "idle"),
            "connected": connected,
            "conference": self._conf.get(agent_id),
        }

    def _set_lead_status(self, lead_id: str, status: str) -> None:
        with self._db_lock:
            conn = self._conn()
            try:
                conn.execute("UPDATE leads SET status=?, updated_at=? WHERE lead_id=?",
                             (status, _iso(_now()), lead_id))
                conn.commit()
            finally:
                conn.close()

    # ── metrics (§14) ────────────────────────────────────────────
    def metrics(self, agent_id: str | None = None, window_hours: int = 24) -> dict:
        """Aggregate dialer performance over the last `window_hours`. Per-agent when
        agent_id is given, else account-wide. Cost is the DIAL cost (outbound leg +
        AMD fee); it excludes the agent's always-on conference line, which isn't a
        per-call quantity. Read-only — safe to call from the UI poll."""
        since = _iso(_now() - timedelta(hours=window_hours))
        conn = self._conn()
        try:
            where = "started_at >= ?"
            args: list = [since]
            if agent_id:
                where += " AND agent_id = ?"
                args.append(agent_id)

            outcomes = {"human": 0, "machine": 0, "no_answer": 0, "busy": 0, "failed": 0}
            for row in conn.execute(
                    f"SELECT state, COUNT(*) c FROM pd_call_legs WHERE {where} GROUP BY state", args):
                st = (row["state"] or "").lower()
                if st in outcomes:
                    outcomes[st] += row["c"]
            agg = conn.execute(
                f"""SELECT COUNT(*) dials,
                           COALESCE(SUM(CASE WHEN ended_at IS NOT NULL AND started_at IS NOT NULL
                                THEN (julianday(ended_at)-julianday(started_at))*86400 ELSE 0 END), 0) leg_seconds
                    FROM pd_call_legs WHERE {where}""", args).fetchone()
            dials = agg["dials"] or 0
            leg_seconds = float(agg["leg_seconds"] or 0.0)
            connects = outcomes["human"]

            # Dispositions + talk time (join conversations for per-agent scoping).
            if agent_id:
                dispo_rows = conn.execute(
                    """SELECT d.code, COUNT(*) c FROM pd_dispositions d
                       JOIN pd_conversations cv ON cv.id = d.conversation_id
                       WHERE cv.agent_id = ? AND d.created_at >= ? GROUP BY d.code""",
                    (agent_id, since)).fetchall()
                talk = conn.execute(
                    """SELECT COUNT(*) n,
                              COALESCE(SUM(CASE WHEN ended_at IS NOT NULL
                                   THEN (julianday(ended_at)-julianday(started_at))*86400 ELSE 0 END), 0) s
                       FROM pd_conversations WHERE agent_id = ? AND started_at >= ?""",
                    (agent_id, since)).fetchone()
            else:
                dispo_rows = conn.execute(
                    "SELECT code, COUNT(*) c FROM pd_dispositions WHERE created_at >= ? GROUP BY code",
                    (since,)).fetchall()
                talk = conn.execute(
                    """SELECT COUNT(*) n,
                              COALESCE(SUM(CASE WHEN ended_at IS NOT NULL
                                   THEN (julianday(ended_at)-julianday(started_at))*86400 ELSE 0 END), 0) s
                       FROM pd_conversations WHERE started_at >= ?""", (since,)).fetchone()
            dispositions = {r["code"]: r["c"] for r in dispo_rows}
            conv_n = talk["n"] or 0
            talk_seconds = float(talk["s"] or 0.0)

            est_cost = dials * _FEE_AMD_PER_CALL + (leg_seconds / 60.0) * _RATE_OUTBOUND_PER_MIN
            return {
                "window_hours": window_hours,
                "dials": dials,
                "connects": connects,
                "connect_rate": round(connects / dials, 4) if dials else 0.0,
                "outcomes": outcomes,
                "dispositions": dispositions,
                "conversations": conv_n,
                "talk_seconds": round(talk_seconds),
                "avg_talk_seconds": round(talk_seconds / conv_n) if conv_n else 0,
                "est_dial_cost": round(est_cost, 2),
                "cost_per_connect": round(est_cost / connects, 2) if connects else 0.0,
            }
        finally:
            conn.close()

    def recording_context(self, call_sid: str) -> dict | None:
        """Resolve a Twilio Call SID back to its lead for recording ingest (§ recording).
        Returns {lead_id, seller_name, property_address} or None if the leg is unknown."""
        conn = self._conn()
        try:
            row = conn.execute(
                """SELECT cl.lead_id, o.owner_name, p.address_full
                   FROM pd_call_legs cl
                   JOIN leads l ON l.lead_id = cl.lead_id
                   LEFT JOIN owners o ON o.owner_id = l.owner_id
                   LEFT JOIN properties p ON p.property_id = l.property_id
                   WHERE cl.carrier_call_id = ?
                   ORDER BY cl.started_at DESC LIMIT 1""",
                (call_sid,)).fetchone()
            if not row:
                return None
            return {
                "lead_id": row["lead_id"],
                "seller_name": row["owner_name"] or "Unknown",
                "property_address": row["address_full"],
            }
        finally:
            conn.close()
