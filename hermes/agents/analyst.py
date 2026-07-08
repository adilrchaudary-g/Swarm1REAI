"""Analyst agent — underwriting, ARV validation, deal quality checks."""

from __future__ import annotations

from .base import BaseAgent


class AnalystAgent(BaseAgent):
    agent_type = "analyst"

    def execute(self) -> None:
        self._underwrite_unanalyzed()
        self._flag_bad_deals()
        self._refresh_stale_reports()
        self._check_offer_readiness()
        self._arv_cross_check()

    # ------------------------------------------------------------------
    # 1. Underwrite unanalyzed leads
    # ------------------------------------------------------------------
    def _underwrite_unanalyzed(self) -> None:
        self.log("Checking for leads without underwriting reports")
        rows = self.query(
            """
            SELECT l.lead_id, l.status, p.address_full, o.owner_name
            FROM leads l
            LEFT JOIN properties p ON p.property_id = l.property_id
            LEFT JOIN owners o ON o.owner_id = l.owner_id
            LEFT JOIN underwriting_reports ur ON ur.lead_id = l.lead_id
            WHERE l.status IN ('interested','scored','queued')
              AND ur.id IS NULL
            LIMIT 20
            """,
        )
        self._leads_scanned += len(rows)
        for r in rows:
            addr = r.get("address_full") or "unknown address"
            priority = "high" if r["status"] == "interested" else "medium"
            self.create_proposal(
                title=f"Run underwriting: {addr}",
                description=(
                    f"Lead {r['lead_id']} ({addr}) is in '{r['status']}' status "
                    f"but has no underwriting report yet."
                ),
                payload={
                    "action": "run_underwriting",
                    "lead_id": r["lead_id"],
                },
                priority=priority,
            )
        self.log(f"Found {len(rows)} leads needing underwriting")

    # ------------------------------------------------------------------
    # 2. Flag bad deals
    # ------------------------------------------------------------------
    def _flag_bad_deals(self) -> None:
        self.log("Scanning for bad deals to kill")
        rows = self.query(
            """
            SELECT ur.lead_id, ur.arv_final, ur.mao_70, ur.overall_grade,
                   p.address_full
            FROM underwriting_reports ur
            JOIN leads l ON l.lead_id = ur.lead_id
            LEFT JOIN properties p ON p.property_id = l.property_id
            WHERE (ur.mao_70 < 50000 OR ur.overall_grade IN ('D','F'))
              AND l.status NOT IN ('dead','archived')
            """,
        )
        self._leads_scanned += len(rows)
        for r in rows:
            addr = r.get("address_full") or "unknown address"
            reasons = []
            if r.get("mao_70") is not None and r["mao_70"] < 50000:
                reasons.append(f"MAO-70 is only ${r['mao_70']:,.0f}")
            if r.get("overall_grade") in ("D", "F"):
                reasons.append(f"grade is {r['overall_grade']}")
            reason_str = " and ".join(reasons)
            self.create_proposal(
                title=f"Kill bad deal: {addr}",
                description=f"Lead {r['lead_id']} at {addr} — {reason_str}. Not worth pursuing.",
                payload={
                    "action": "update_status",
                    "lead_id": r["lead_id"],
                    "new_status": "dead",
                    "reason": f"Bad deal: {reason_str}",
                },
                priority="high",
            )
        self.log(f"Flagged {len(rows)} bad deals")

    # ------------------------------------------------------------------
    # 3. Refresh stale underwriting reports
    # ------------------------------------------------------------------
    def _refresh_stale_reports(self) -> None:
        self.log("Looking for stale underwriting reports (>30 days)")
        rows = self.query(
            """
            SELECT ur.lead_id, ur.updated_at, p.address_full
            FROM underwriting_reports ur
            JOIN leads l ON l.lead_id = ur.lead_id
            LEFT JOIN properties p ON p.property_id = l.property_id
            WHERE julianday('now') - julianday(ur.updated_at) > 30
              AND l.status IN ('queued','interested','underwriting')
            """,
        )
        self._leads_scanned += len(rows)
        for r in rows:
            addr = r.get("address_full") or "unknown address"
            self.create_proposal(
                title=f"Refresh underwriting: {addr}",
                description=(
                    f"Report for {addr} (lead {r['lead_id']}) was last updated "
                    f"{r['updated_at']}. Data may be stale — re-run comps and ARV."
                ),
                payload={
                    "action": "run_underwriting",
                    "lead_id": r["lead_id"],
                    "reason": "Stale report refresh",
                },
                priority="low",
            )
        self.log(f"Found {len(rows)} stale reports to refresh")

    # ------------------------------------------------------------------
    # 4. Offer readiness check
    # ------------------------------------------------------------------
    def _check_offer_readiness(self) -> None:
        self.log("Checking offer readiness for underwriting leads")
        rows = self.query(
            """
            SELECT ur.*, p.address_full
            FROM underwriting_reports ur
            JOIN leads l ON l.lead_id = ur.lead_id
            LEFT JOIN properties p ON p.property_id = l.property_id
            WHERE l.status = 'underwriting'
            """,
        )
        self._leads_scanned += len(rows)
        for r in rows:
            addr = r.get("address_full") or "unknown address"
            missing = []
            if not r.get("arv_final"):
                missing.append("ARV")
            if not r.get("mao_70"):
                missing.append("MAO-70")
            if not r.get("recommendation"):
                missing.append("recommendation")

            if not missing:
                self.create_proposal(
                    title=f"Offer ready: {addr}",
                    description=(
                        f"Lead {r['lead_id']} at {addr} has complete underwriting: "
                        f"ARV ${r['arv_final']:,.0f}, MAO-70 ${r['mao_70']:,.0f}, "
                        f"recommendation: {r.get('recommendation')}. Ready to make an offer."
                    ),
                    payload={
                        "action": "add_note",
                        "lead_id": r["lead_id"],
                        "note": "Offer ready — underwriting complete",
                    },
                    priority="high",
                )
            else:
                missing_str = ", ".join(missing)
                self.create_proposal(
                    title=f"Incomplete underwriting: {addr}",
                    description=(
                        f"Lead {r['lead_id']} at {addr} is in underwriting but "
                        f"still missing: {missing_str}."
                    ),
                    payload={
                        "action": "add_note",
                        "lead_id": r["lead_id"],
                        "note": f"Underwriting incomplete — missing: {missing_str}",
                    },
                    priority="medium",
                )
        self.log(f"Checked {len(rows)} underwriting leads for offer readiness")

    # ------------------------------------------------------------------
    # 5. ARV cross-check
    # ------------------------------------------------------------------
    def _arv_cross_check(self) -> None:
        self.log("Cross-checking ARV estimates vs underwriting finals")
        rows = self.query(
            """
            SELECT l.lead_id, l.arv_estimate, ur.arv_final, p.address_full
            FROM leads l
            JOIN underwriting_reports ur ON ur.lead_id = l.lead_id
            LEFT JOIN properties p ON p.property_id = l.property_id
            WHERE l.arv_estimate IS NOT NULL
              AND ur.arv_final IS NOT NULL
            """,
        )
        self._leads_scanned += len(rows)
        flagged = 0
        for r in rows:
            estimate = float(r["arv_estimate"])
            final = float(r["arv_final"])
            if estimate == 0:
                continue
            diff_pct = abs(final - estimate) / estimate
            if diff_pct > 0.20:
                addr = r.get("address_full") or "unknown address"
                direction = "higher" if final > estimate else "lower"
                flagged += 1
                self.create_proposal(
                    title=f"ARV mismatch: {addr}",
                    description=(
                        f"Lead {r['lead_id']} at {addr}: initial ARV estimate was "
                        f"${estimate:,.0f} but underwriting says ${final:,.0f} "
                        f"({diff_pct:.0%} {direction}). Worth double-checking comps."
                    ),
                    payload={
                        "action": "add_note",
                        "lead_id": r["lead_id"],
                        "note": (
                            f"ARV discrepancy: estimate ${estimate:,.0f} vs "
                            f"final ${final:,.0f} ({diff_pct:.0%} {direction})"
                        ),
                    },
                    priority="medium",
                )
        self.log(f"Found {flagged} ARV mismatches out of {len(rows)} checked")
