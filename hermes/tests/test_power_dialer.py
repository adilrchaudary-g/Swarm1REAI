"""PD-5 acceptance tests (spec §15) for the spec-compliant power dialer.

The defining properties under test:
  - ZERO ABANDONMENT: a live human is always bridged to a warm agent; a machine is
    silently hung up and never bridged (the agent hears only humans).
  - AMD STRICTNESS: ambiguous/unknown detection is treated as a machine, never a human.
  - COMPLIANCE GATES: dial-set excludes DNC, suppressed, non-cell, bad, and
    out-of-calling-window numbers (window derives from the DIALED NPA's tz, §9.4).
  - CADENCE: per-number backoff + disable-after-N for machines/failures (§10).
  - DISPOSITIONS: each code drives the documented lead/number/suppression transition (§11).
  - ORPHAN RECOVERY: crash-stranded legs/leads are cleaned up on startup (§12).

No real carrier, no threads: a FakeCarrier resolves each leg *inline* inside
originate() by calling the dialer's webhook handlers. Because _dial_one registers
the leg before calling originate and only then blocks on the leg's Event, resolving
inside originate sets the Event before the wait — so every dial completes
synchronously and deterministically.
"""
from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hermes.store import HermesStore
from hermes import power_dialer_engine as pde
from hermes.power_dialer_engine import PowerDialer
from hermes.carrier import CarrierAdapter


# ── Fake carrier ────────────────────────────────────────────────────
class FakeCarrier(CarrierAdapter):
    """Scriptable carrier. `outcomes` is the ordered list of how successive dials
    resolve: 'human' | 'machine' | 'unknown' | 'no_answer' | 'busy' | 'failed_status'
    | 'originate_fail'. Each originate() pops the next and drives the matching
    webhook handler(s) inline, so the dialer's blocking wait returns at once."""

    def __init__(self, outcomes: list[str], owned_numbers: list[str] | None = None) -> None:
        super().__init__()
        self.outcomes = list(outcomes)
        self.owned_numbers = list(owned_numbers or [])
        self.pd: PowerDialer | None = None
        self.originated: list[dict] = []
        self.bridged: list[tuple[str, str]] = []
        self.hung_up: list[str] = []
        self._sid = 0

    def list_owned_numbers(self):
        return list(self.owned_numbers)

    def originate(self, *, to, from_did, agent_id, amd, ring_timeout_s, leg_ref):
        self.originated.append({"to": to, "from_did": from_did, "leg_ref": leg_ref})
        outcome = self.outcomes.pop(0) if self.outcomes else "no_answer"
        if outcome == "originate_fail":
            return None
        self._sid += 1
        sid = f"CA{self._sid:032d}"
        # Resolve inline via the real webhook entry points.
        assert self.pd is not None
        if outcome == "human":
            self.pd.handle_amd(leg_ref, "human")
        elif outcome == "machine":
            self.pd.handle_amd(leg_ref, "machine")
        elif outcome == "unknown":
            self.pd.handle_amd(leg_ref, "unknown")
        elif outcome == "no_answer":
            self.pd.handle_status(leg_ref, "no-answer")
        elif outcome == "busy":
            self.pd.handle_status(leg_ref, "busy")
        elif outcome == "failed_status":
            self.pd.handle_status(leg_ref, "failed")
        return sid

    def hangup(self, leg):
        self.hung_up.append(leg)
        return True

    def bridge_to_conference(self, leg, conf):
        self.bridged.append((leg, conf))
        return True

    def create_conference(self, agent_id):
        return f"conf-{agent_id}"

    def join_agent(self, agent_id, conf):
        return f"agentleg-{agent_id}"


# ── Fixture helpers ─────────────────────────────────────────────────
def _row(conn: sqlite3.Connection, sql: str, args=()) -> sqlite3.Row | None:
    conn.row_factory = sqlite3.Row
    return conn.execute(sql, args).fetchone()


class PowerDialerTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.store = HermesStore(self.root)
        self.store.initialize()
        self.db_path = str(self.store.db_path)
        # Freeze "now" to a mid-day Eastern moment so calling-window checks pass by
        # default (16:00 UTC == 12:00 ET). Individual tests override _now as needed.
        self._fixed_now = datetime(2026, 7, 15, 16, 0, 0, tzinfo=timezone.utc)
        self._orig_now = pde._now
        pde._now = lambda: self._fixed_now

    def tearDown(self) -> None:
        pde._now = self._orig_now
        self.temp_dir.cleanup()

    def set_now(self, dt: datetime) -> None:
        self._fixed_now = dt

    # Insert one property→owner→lead→cell, return (lead_id, owner_id, phone_id).
    def seed_lead(self, *, npa: str = "407", phone_type: str = "cell",
                  dnc: int = 0, status: str = "queued", digits: str | None = None):
        digits = digits or f"{npa}5550100"
        e164_local = f"{npa}5550100"
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            now = "2026-07-15T00:00:00+00:00"
            conn.execute(
                "INSERT INTO properties (property_id, lane, address_full, updated_at) "
                "VALUES ('P1','houses','123 Main St, Orlando FL',?)", (now,))
            conn.execute(
                "INSERT INTO owners (owner_id, property_id, owner_name, updated_at) "
                "VALUES ('O1','P1','Jane Doe',?)", (now,))
            conn.execute(
                "INSERT INTO leads (lead_id, property_id, owner_id, created_at, updated_at, "
                "status, pd_priority) VALUES ('L1','P1','O1',?,?,?,10)", (now, now, status))
            cur = conn.execute(
                "INSERT INTO owner_phones (owner_id, phone_value, phone_digits, phone_type, "
                "dnc, npa, dial_priority, updated_at) VALUES ('O1',?,?,?,?,?,10,?)",
                (f"+1{e164_local}", e164_local, phone_type, dnc, npa, now))
            phone_id = cur.lastrowid
            conn.commit()
        finally:
            conn.close()
        return "L1", "O1", phone_id

    def phone_row(self, phone_id: int) -> sqlite3.Row:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute("SELECT * FROM owner_phones WHERE id=?", (phone_id,)).fetchone()
        finally:
            conn.close()

    def lead_status(self, lead_id: str = "L1") -> str:
        conn = sqlite3.connect(self.db_path)
        try:
            return conn.execute("SELECT status FROM leads WHERE lead_id=?", (lead_id,)).fetchone()[0]
        finally:
            conn.close()

    def make_dialer(self, outcomes: list[str],
                    owned_numbers: list[str] | None = None) -> tuple[PowerDialer, FakeCarrier]:
        fake = FakeCarrier(outcomes, owned_numbers)
        pd = PowerDialer(self.db_path, fake)
        fake.pd = pd
        return pd, fake


# ── Zero-abandonment + AMD strictness (the core safety property) ─────
class ZeroAbandonmentTests(PowerDialerTestBase):
    def test_human_is_bridged_never_hung_up(self):
        _, _, phone_id = self.seed_lead()
        pd, fake = self.make_dialer(["human"])
        number = self.phone_row(phone_id)
        outcome, leg_ref = pd._dial_one("L1", number, "agent1", "conf-agent1")
        self.assertEqual(outcome, "human")
        self.assertEqual(len(fake.bridged), 1, "human must be bridged to the conference")
        self.assertEqual(fake.hung_up, [], "a bridged human must NOT be hung up")

    def test_machine_is_hung_up_never_bridged(self):
        _, _, phone_id = self.seed_lead()
        pd, fake = self.make_dialer(["machine"])
        outcome, _ = pd._dial_one("L1", self.phone_row(phone_id), "agent1", "conf-agent1")
        self.assertEqual(outcome, "machine")
        self.assertEqual(fake.bridged, [], "a machine must NEVER reach the agent")
        self.assertEqual(len(fake.hung_up), 1, "a machine leg must be hung up")

    def test_unknown_amd_treated_as_machine(self):
        _, _, phone_id = self.seed_lead()
        pd, fake = self.make_dialer(["unknown"])
        outcome, _ = pd._dial_one("L1", self.phone_row(phone_id), "agent1", "conf-agent1")
        self.assertEqual(outcome, "machine", "ambiguous AMD must resolve to machine, not human")
        self.assertEqual(fake.bridged, [])

    def test_no_answer_and_busy_and_failed(self):
        for scripted, expected in [("no_answer", "no_answer"), ("busy", "busy"),
                                   ("failed_status", "failed")]:
            with self.subTest(scripted=scripted):
                self.tearDown(); self.setUp()
                _, _, phone_id = self.seed_lead()
                pd, fake = self.make_dialer([scripted])
                outcome, _ = pd._dial_one("L1", self.phone_row(phone_id), "a", "conf-a")
                self.assertEqual(outcome, expected)
                self.assertEqual(fake.bridged, [])

    def test_originate_failure_is_failed_leg(self):
        _, _, phone_id = self.seed_lead()
        pd, fake = self.make_dialer(["originate_fail"])
        outcome, leg_ref = pd._dial_one("L1", self.phone_row(phone_id), "a", "conf-a")
        self.assertEqual(outcome, "failed")
        # a failed originate still records the leg for audit
        conn = sqlite3.connect(self.db_path)
        try:
            state = conn.execute("SELECT state FROM pd_call_legs WHERE id=?", (leg_ref,)).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(state)
        self.assertEqual(state[0], "failed")


# ── Compliance gates (§9) ───────────────────────────────────────────
class ComplianceGateTests(PowerDialerTestBase):
    def test_landline_excluded(self):
        _, _, _ = self.seed_lead(phone_type="landline")
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.dialable_numbers("L1"), [], "landlines are not dialable")

    def test_dnc_excluded(self):
        self.seed_lead(dnc=1)
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.dialable_numbers("L1"), [])

    def test_suppressed_number_excluded(self):
        _, _, phone_id = self.seed_lead(npa="407")
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO pd_suppressions (e164, reason, added_at) VALUES ('+14075550100','internal_dnc','x')")
        conn.commit(); conn.close()
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.dialable_numbers("L1"), [], "suppressed e164 must be gated at dial time")

    def test_cell_is_dialable_any_hour(self):
        # Calling-window gate removed per operator — a clean cell is dialable
        # regardless of the local time of day.
        self.seed_lead(npa="407")
        pd, _ = self.make_dialer([])
        self.set_now(datetime(2026, 7, 16, 2, 0, 0, tzinfo=timezone.utc))  # 10pm ET
        self.assertEqual(len(pd.dialable_numbers("L1")), 1, "no time-of-day gate should block dialing")


# ── Cadence / backoff (§10) ─────────────────────────────────────────
class CadenceTests(PowerDialerTestBase):
    def test_no_answer_sets_future_backoff(self):
        _, _, phone_id = self.seed_lead()
        pd, _ = self.make_dialer([])
        pd._record_terminal_cadence(self.phone_row(phone_id), "no_answer")
        row = self.phone_row(phone_id)
        self.assertEqual(row["last_result"], "no_answer")
        self.assertEqual(row["dial_attempt_count"], 1)
        self.assertIsNotNone(row["next_eligible_at"])
        self.assertGreater(datetime.fromisoformat(row["next_eligible_at"]), self._fixed_now)

    def test_machine_disables_after_max(self):
        _, _, phone_id = self.seed_lead()
        pd, _ = self.make_dialer([])
        for i in range(pde.MACHINE_MAX):
            pd._record_terminal_cadence(self.phone_row(phone_id), "machine")
        row = self.phone_row(phone_id)
        self.assertEqual(row["dial_attempt_count"], pde.MACHINE_MAX)
        self.assertEqual(row["dial_disabled"], 1, "a number must be disabled after MACHINE_MAX machines")

    def test_human_does_not_advance_cadence_counters(self):
        _, _, phone_id = self.seed_lead()
        pd, _ = self.make_dialer([])
        pd._record_terminal_cadence(self.phone_row(phone_id), "human")
        row = self.phone_row(phone_id)
        self.assertEqual(row["dial_attempt_count"] or 0, 0, "human contact resets/skips the cadence counter")


# ── Dispositions (§11) ──────────────────────────────────────────────
class DispositionTests(PowerDialerTestBase):
    def _apply(self, code: str, **dispo):
        _, _, phone_id = self.seed_lead(status="dialing")
        pd, _ = self.make_dialer([])
        conv_id = pd._open_conversation("leg-x", "L1", "agent1")
        number = self.phone_row(phone_id)
        pd._apply_disposition("L1", number, conv_id, {"code": code, **dispo})
        return phone_id

    def test_wrong_number_suppresses_and_requeues(self):
        phone_id = self._apply("wrong_number")
        row = self.phone_row(phone_id)
        self.assertEqual(row["dial_disabled"], 1)
        self.assertEqual(self.lead_status(), "queued", "wrong number → other numbers still get a shot")
        conn = sqlite3.connect(self.db_path)
        try:
            supp = conn.execute("SELECT reason FROM pd_suppressions WHERE e164='+14075550100'").fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(supp)

    def test_dnc_request_kills_lead(self):
        self._apply("dnc_request", dnc_request=True)
        self.assertEqual(self.lead_status(), "dead")

    def test_callback_requeues_with_future_action(self):
        cb = "2026-07-20T15:00:00+00:00"
        self._apply("callback", callback_at=cb)
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute("SELECT status, pd_next_action_at FROM leads WHERE lead_id='L1'").fetchone()
        finally:
            conn.close()
        self.assertEqual(row[0], "queued")
        self.assertEqual(row[1], cb)

    def test_not_interested_marks_lead(self):
        self._apply("not_interested")
        self.assertEqual(self.lead_status(), "not_interested")

    def test_interested_keeps_lead_in_play(self):
        self._apply("interested")
        self.assertEqual(self.lead_status(), "interested")

    def test_disposition_is_persisted(self):
        self._apply("interested", notes="Wants $120k")
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute("SELECT code, notes FROM pd_dispositions WHERE lead_id='L1'").fetchone()
        finally:
            conn.close()
        self.assertEqual(row[0], "interested")
        self.assertEqual(row[1], "Wants $120k")


# ── Queue claiming + orphan recovery (§12) ──────────────────────────
class QueueAndRecoveryTests(PowerDialerTestBase):
    def test_claim_skips_future_next_action(self):
        self.seed_lead()
        conn = sqlite3.connect(self.db_path)
        future = (self._fixed_now + timedelta(hours=2)).isoformat()
        conn.execute("UPDATE leads SET pd_next_action_at=? WHERE lead_id='L1'", (future,))
        conn.commit(); conn.close()
        pd, _ = self.make_dialer([])
        self.assertIsNone(pd.claim_next_lead("agent1"), "a lead scheduled for later must not be claimed")

    def test_claim_takes_eligible_lead_and_marks_dialing(self):
        self.seed_lead()
        pd, _ = self.make_dialer([])
        claimed = pd.claim_next_lead("agent1")
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed["lead_id"], "L1")
        self.assertEqual(self.lead_status(), "dialing", "claiming must flip the lead to 'dialing'")

    def test_recover_orphans_requeues_stranded_work(self):
        self.seed_lead(status="dialing")
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO pd_call_legs (id, lead_id, owner_phone_id, agent_id, carrier_call_id, "
            "from_did, state, connect_mode, started_at) "
            "VALUES ('leg-orphan','L1',1,'agent1','CAxx','+1','dialing','amd_screen','x')")
        conn.commit(); conn.close()
        pd, _ = self.make_dialer([])
        result = pd.recover_orphans()
        self.assertEqual(result["legs_failed"], 1)
        self.assertEqual(result["leads_requeued"], 1)
        self.assertEqual(self.lead_status(), "queued", "a lead stuck 'dialing' at restart returns to the queue")
        conn = sqlite3.connect(self.db_path)
        try:
            leg_state = conn.execute("SELECT state FROM pd_call_legs WHERE id='leg-orphan'").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(leg_state, "failed")


# ── Local-presence caller ID (PD-7) ─────────────────────────────────
class CallerIdTests(PowerDialerTestBase):
    def setUp(self):
        super().setUp()
        self._orig_did = __import__("os").environ.get("TWILIO_PHONE_NUMBER")
        __import__("os").environ["TWILIO_PHONE_NUMBER"] = "+12166165644"  # 216 / OH default

    def tearDown(self):
        import os
        if self._orig_did is None:
            os.environ.pop("TWILIO_PHONE_NUMBER", None)
        else:
            os.environ["TWILIO_PHONE_NUMBER"] = self._orig_did
        super().tearDown()

    def _seed_did(self, e164, npa, state, active=1):
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT OR REPLACE INTO pd_did_pool (e164, npa, state, active, added_at) "
                     "VALUES (?,?,?,?,'x')", (e164, npa, state, active))
        conn.commit(); conn.close()

    def test_empty_pool_falls_back_to_env_default(self):
        _, _, phone_id = self.seed_lead(npa="407")
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.select_caller_id(self.phone_row(phone_id)), "+12166165644")

    def test_exact_npa_match_wins(self):
        _, _, phone_id = self.seed_lead(npa="407")
        self._seed_did("+14075551000", "407", "FL")
        self._seed_did("+18135552000", "813", "FL")
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.select_caller_id(self.phone_row(phone_id)), "+14075551000")

    def test_same_state_fallback(self):
        _, _, phone_id = self.seed_lead(npa="407")  # FL, no 407 DID owned
        self._seed_did("+18135552000", "813", "FL")  # different NPA, same state
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.select_caller_id(self.phone_row(phone_id)), "+18135552000")

    def test_no_match_uses_default(self):
        _, _, phone_id = self.seed_lead(npa="407")  # FL
        self._seed_did("+12145553000", "214", "TX")  # different state entirely
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.select_caller_id(self.phone_row(phone_id)), "+12166165644")

    def test_inactive_did_is_skipped(self):
        _, _, phone_id = self.seed_lead(npa="407")
        self._seed_did("+14075551000", "407", "FL", active=0)
        pd, _ = self.make_dialer([])
        self.assertEqual(pd.select_caller_id(self.phone_row(phone_id)), "+12166165644")

    def test_sync_did_pool_derives_npa_and_state(self):
        self.seed_lead()
        pd, _ = self.make_dialer([], owned_numbers=["+14075551000", "+12145553000"])
        n = pd.sync_did_pool()
        self.assertEqual(n, 2)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = {r["e164"]: r for r in conn.execute("SELECT * FROM pd_did_pool")}
        finally:
            conn.close()
        self.assertEqual(rows["+14075551000"]["npa"], "407")
        self.assertEqual(rows["+14075551000"]["state"], "FL")
        self.assertEqual(rows["+12145553000"]["state"], "TX")


# ── Metrics (§14) ───────────────────────────────────────────────────
class MetricsTests(PowerDialerTestBase):
    def test_metrics_counts_outcomes_dispositions_and_connects(self):
        _, _, phone_id = self.seed_lead()
        pd, _ = self.make_dialer(["human", "machine", "no_answer", "human"])
        number = self.phone_row(phone_id)
        # Two humans (each opens a conversation + disposition), one machine, one no-answer.
        for outcome in ("human", "machine", "no_answer", "human"):
            pd, fake = self.make_dialer([outcome])
            o, leg_ref = pd._dial_one("L1", number, "agent1", "conf-agent1")
            if o == "human":
                conv = pd._open_conversation(leg_ref, "L1", "agent1")
                pd._apply_disposition("L1", number, conv, {"code": "interested", "notes": "x"})
        m = pd.metrics("agent1", window_hours=24)
        self.assertEqual(m["outcomes"]["human"], 2)
        self.assertEqual(m["outcomes"]["machine"], 1)
        self.assertEqual(m["outcomes"]["no_answer"], 1)
        self.assertEqual(m["dials"], 4)
        self.assertEqual(m["connects"], 2)
        self.assertAlmostEqual(m["connect_rate"], 0.5, places=3)
        self.assertEqual(m["dispositions"].get("interested"), 2)
        self.assertGreaterEqual(m["est_dial_cost"], 0.0)

    def test_metrics_empty_is_zeroed_not_error(self):
        self.seed_lead()
        pd, _ = self.make_dialer([])
        m = pd.metrics("agent1")
        self.assertEqual(m["dials"], 0)
        self.assertEqual(m["connect_rate"], 0.0)
        self.assertEqual(m["dispositions"], {})


# ── Recording context lookup (call recording ingest) ────────────────
class RecordingContextTests(PowerDialerTestBase):
    def test_recording_context_resolves_lead_from_call_sid(self):
        _, _, phone_id = self.seed_lead()
        pd, _ = self.make_dialer([])
        # Persist a leg carrying a known Twilio Call SID.
        pd._insert_leg("leg-rc", "L1", phone_id, "agent1", "CA_test_sid_123",
                       "+12166165644", "dialing")
        ctx = pd.recording_context("CA_test_sid_123")
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx["lead_id"], "L1")
        self.assertEqual(ctx["seller_name"], "Jane Doe")
        self.assertIn("Orlando", ctx["property_address"])

    def test_recording_context_unknown_sid_returns_none(self):
        self.seed_lead()
        pd, _ = self.make_dialer([])
        self.assertIsNone(pd.recording_context("CA_nonexistent"))


if __name__ == "__main__":
    unittest.main()
