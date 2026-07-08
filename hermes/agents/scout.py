"""Scout agent — finds work that needs doing across the pipeline."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from .base import BaseAgent

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime
    from .proxy_client import ClaudeProxyClient


class ScoutAgent(BaseAgent):
    agent_type = "scout"

    def execute(self) -> None:
        self._skip_trace_untraced()
        self._skip_trace_code_violations()
        self._trigger_scrape_if_stale()
        self._run_evaluation_on_unscored()
        self._verify_pending()
        self._signal_stacking()

    # ------------------------------------------------------------------
    # 1. Skip-trace leads without phones (non-code-violation)
    # ------------------------------------------------------------------
    def _skip_trace_untraced(self) -> None:
        self.log("Checking for phoneless non-CV leads...")
        row = self.query_one(
            """
            SELECT COUNT(*) as cnt
            FROM leads l
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE op.phone_value IS NULL
              AND l.status IN ('new','enriched')
              AND l.source != 'code_violations'
            """
        )
        count = row["cnt"] if row else 0
        self._leads_scanned += count
        if count > 20:
            self.log(f"Found {count} non-CV leads without phone numbers")
            self.create_proposal(
                title=f"Skip-trace {count} leads without phones",
                description=(
                    f"There are {count} leads in new/enriched status (excluding code violations) "
                    f"that have no phone number on file. Running skip-trace will look up "
                    f"owner contact info so these leads can enter the dialing queue."
                ),
                payload={"action": "run_skip_trace", "count": count, "source_filter": "non_code_violations"},
                priority="high",
            )

    # ------------------------------------------------------------------
    # 2. Skip-trace code-violation leads without phones
    # ------------------------------------------------------------------
    def _skip_trace_code_violations(self) -> None:
        self.log("Checking for phoneless code-violation leads...")
        row = self.query_one(
            """
            SELECT COUNT(*) as cnt
            FROM leads l
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE op.phone_value IS NULL
              AND l.status IN ('new','enriched')
              AND l.source = 'code_violations'
            """
        )
        count = row["cnt"] if row else 0
        self._leads_scanned += count
        if count > 0:
            self.log(f"Found {count} code-violation leads without phone numbers")
            self.create_proposal(
                title=f"Skip-trace {count} code-violation leads",
                description=(
                    f"{count} code-violation leads have no phone number. "
                    f"These are the bulk pipeline — skip-tracing them unlocks "
                    f"the largest batch of dialable leads."
                ),
                payload={"action": "run_skip_trace", "count": count, "source_filter": "code_violations"},
                priority="high",
            )

    # ------------------------------------------------------------------
    # 3. Trigger scrape if code-violations data is stale
    # ------------------------------------------------------------------
    def _trigger_scrape_if_stale(self) -> None:
        self.log("Checking code-violations freshness...")
        row = self.query_one(
            "SELECT last_run_at FROM source_adapters WHERE source_id = 'code_violations'"
        )
        stale = False
        if row is None or row.get("last_run_at") is None:
            stale = True
            age_desc = "never been run"
        else:
            try:
                last_run = datetime.fromisoformat(
                    row["last_run_at"].replace("Z", "+00:00")
                )
                if not last_run.tzinfo:
                    last_run = last_run.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - last_run
                if age > timedelta(days=3):
                    stale = True
                    age_desc = f"{age.days} days old"
            except (ValueError, TypeError):
                stale = True
                age_desc = "unparseable timestamp"

        if stale:
            self.log(f"Code-violations data is stale ({age_desc})")
            self.create_proposal(
                title="Re-scrape code violations (data is stale)",
                description=(
                    f"Code-violations source data is {age_desc}. "
                    f"Running a fresh scrape will pull new violations and "
                    f"feed the pipeline with recently-filed cases."
                ),
                payload={"action": "run_scrape", "source": "code_violations"},
                priority="medium",
            )

    # ------------------------------------------------------------------
    # 4. Run evaluation on unscored / imported leads
    # ------------------------------------------------------------------
    def _run_evaluation_on_unscored(self) -> None:
        self.log("Checking for unscored imported leads...")
        row = self.query_one(
            "SELECT COUNT(*) as cnt FROM leads WHERE status = 'imported'"
        )
        count = row["cnt"] if row else 0
        if count > 0:
            self.log(f"Found {count} imported leads awaiting evaluation")
            self.create_proposal(
                title=f"Evaluate {count} imported leads",
                description=(
                    f"{count} leads are sitting in 'imported' status and have not "
                    f"been scored or qualified yet. Running evaluation will apply "
                    f"distress-signal rules and motivation scoring."
                ),
                payload={"action": "run_evaluation", "count": count},
                priority="medium",
            )

    # ------------------------------------------------------------------
    # 5. Verify pending leads
    # ------------------------------------------------------------------
    def _verify_pending(self) -> None:
        self.log("Checking for pending verifications...")
        row = self.query_one(
            "SELECT COUNT(*) as cnt FROM pending_verification WHERE status = 'pending'"
        )
        count = (row["cnt"] if row else 0) if row else 0
        if count > 0:
            self.log(f"Found {count} leads pending verification")
            self.create_proposal(
                title=f"Verify {count} pending leads",
                description=(
                    f"{count} leads are waiting in the verification queue. "
                    f"Running verification will confirm property data accuracy "
                    f"and owner information before they enter the dialing queue."
                ),
                payload={"action": "run_verification", "count": count},
                priority="medium",
            )

    # ------------------------------------------------------------------
    # 6. Signal stacking — promote leads with 3+ distress signals
    # ------------------------------------------------------------------
    def _signal_stacking(self) -> None:
        self.log("Scanning for high-signal leads...")
        rows = self.query(
            """
            SELECT l.lead_id, p.address_full, l.distress_signals_json,
                   l.status, l.motivation_score
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            WHERE l.status IN ('new','enriched')
              AND l.distress_signals_json IS NOT NULL
              AND l.distress_signals_json != '[]'
            """
        )
        self._leads_scanned += len(rows)
        promoted = 0
        for row in rows:
            try:
                signals = json.loads(row["distress_signals_json"])
            except (json.JSONDecodeError, TypeError):
                continue
            if len(signals) >= 3:
                signal_names = [
                    s.get("type", s) if isinstance(s, dict) else str(s)
                    for s in signals
                ]
                self.create_proposal(
                    title=f"Promote high-signal lead: {row['address_full']}",
                    description=(
                        f"Lead {row['lead_id']} at {row['address_full']} has "
                        f"{len(signals)} distress signals ({', '.join(signal_names)}). "
                        f"Current status: {row['status']}, motivation score: {row['motivation_score']}. "
                        f"Promoting to 'scored' for priority dialing."
                    ),
                    payload={
                        "action": "promote_lead",
                        "lead_id": row["lead_id"],
                        "new_status": "scored",
                        "signal_count": len(signals),
                        "signals": signal_names,
                    },
                    priority="high",
                )
                promoted += 1

        if promoted:
            self.log(f"Created {promoted} promotion proposals for high-signal leads")
        else:
            self.log("No leads with 3+ distress signals found")
