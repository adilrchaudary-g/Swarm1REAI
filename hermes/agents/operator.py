"""Operator agent — deduplication, stuck leads, hygiene, bulk cleanup."""

from __future__ import annotations

from .base import BaseAgent


class OperatorAgent(BaseAgent):
    agent_type = "operator"

    def execute(self) -> None:
        self._deduplicate()
        self._fix_stuck_statuses()
        self._clean_uncontactable()
        self._archive_dead_weight()
        self._stale_proposal_cleanup()

    # ------------------------------------------------------------------
    # 1. Deduplicate leads by address
    # ------------------------------------------------------------------
    def _deduplicate(self) -> None:
        self.log("Scanning for duplicate addresses")
        dupes = self.query(
            """
            SELECT UPPER(TRIM(p.address_full)) AS addr,
                   GROUP_CONCAT(l.lead_id) AS ids,
                   COUNT(*) AS cnt
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            WHERE l.status NOT IN ('dead','archived')
              AND p.address_full IS NOT NULL
            GROUP BY addr
            HAVING cnt > 1
            """,
        )
        flagged = 0
        for d in dupes:
            lead_ids = d["ids"].split(",")
            # Find which lead has the most phone numbers
            best_id = None
            best_phones = -1
            for lid in lead_ids:
                row = self.query_one(
                    """
                    SELECT COUNT(op.id) AS phone_cnt
                    FROM leads l
                    LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
                    WHERE l.lead_id = ?
                    """,
                    (lid,),
                )
                cnt = row["phone_cnt"] if row else 0
                if cnt > best_phones:
                    best_phones = cnt
                    best_id = lid

            # Flag all others as duplicates
            for lid in lead_ids:
                if lid == best_id:
                    continue
                flagged += 1
                self.create_proposal(
                    title=f"Flag duplicate: {d['addr']}",
                    description=(
                        f"Lead {lid} is a duplicate of {best_id} at {d['addr']}. "
                        f"Keeping {best_id} (has {best_phones} phone numbers)."
                    ),
                    payload={
                        "action": "flag_duplicate",
                        "lead_id": lid,
                        "keep_lead_id": best_id,
                        "reason": f"Duplicate address: {d['addr']}",
                    },
                    priority="medium",
                )
        self.log(f"Found {len(dupes)} duplicate groups, flagged {flagged} leads")

    # ------------------------------------------------------------------
    # 2. Fix stuck statuses
    # ------------------------------------------------------------------
    def _fix_stuck_statuses(self) -> None:
        self.log("Checking for stuck leads by status")

        status_rules: list[dict] = [
            {
                "status": "new",
                "days": 14,
                "action": "update_status",
                "new_status": "dead",
                "label": "Stuck in 'new' for 14+ days",
            },
            {
                "status": "enriched",
                "days": 7,
                "action": "update_status",
                "new_status": "scored",
                "label": "Stuck in 'enriched' for 7+ days — auto-promote or kill",
            },
            {
                "status": "scored",
                "days": 14,
                "action": "update_status",
                "new_status": "queued",
                "label": "Stuck in 'scored' for 14+ days — push to queue",
            },
            {
                "status": "contacted",
                "days": 30,
                "action": "create_follow_up",
                "new_status": None,
                "label": "Contacted 30+ days ago with no follow-up",
            },
            {
                "status": "underwriting",
                "days": 21,
                "action": "add_note",
                "new_status": None,
                "label": "Stuck in underwriting for 21+ days",
            },
        ]

        total = 0
        for rule in status_rules:
            rows = self.query(
                """
                SELECT l.lead_id, l.status, l.updated_at, p.address_full
                FROM leads l
                LEFT JOIN properties p ON p.property_id = l.property_id
                WHERE l.status = ?
                  AND julianday('now') - julianday(l.updated_at) > ?
                LIMIT 20
                """,
                (rule["status"], rule["days"]),
            )
            self._leads_scanned += len(rows)
            for r in rows:
                total += 1
                addr = r.get("address_full") or "unknown address"
                payload: dict = {
                    "action": rule["action"],
                    "lead_id": r["lead_id"],
                    "reason": rule["label"],
                }
                if rule["new_status"]:
                    payload["new_status"] = rule["new_status"]
                if rule["action"] == "add_note":
                    payload["note"] = (
                        f"Stuck in '{rule['status']}' for over {rule['days']} days"
                    )
                if rule["action"] == "create_follow_up":
                    payload["follow_up_type"] = "check_in"

                self.create_proposal(
                    title=f"{rule['label']}: {addr}",
                    description=(
                        f"Lead {r['lead_id']} at {addr} has been in '{r['status']}' "
                        f"since {r['updated_at']}. Recommend: {rule['action']}."
                    ),
                    payload=payload,
                    priority="medium",
                )
        self.log(f"Found {total} stuck leads across all statuses")

    # ------------------------------------------------------------------
    # 3. Clean uncontactable leads
    # ------------------------------------------------------------------
    def _clean_uncontactable(self) -> None:
        self.log("Finding leads with no contactable phone numbers")
        rows = self.query(
            """
            SELECT l.lead_id, p.address_full
            FROM leads l
            LEFT JOIN properties p ON p.property_id = l.property_id
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE l.status IN ('queued','contacted')
            GROUP BY l.lead_id
            HAVING COUNT(op.phone_value) = 0
               OR SUM(CASE WHEN op.dnc = 1 THEN 1 ELSE 0 END) = COUNT(op.phone_value)
            LIMIT 30
            """,
        )
        self._leads_scanned += len(rows)
        for r in rows:
            addr = r.get("address_full") or "unknown address"
            self.create_proposal(
                title=f"No contactable phones: {addr}",
                description=(
                    f"Lead {r['lead_id']} at {addr} is queued/contacted but has "
                    f"zero working phone numbers. Dead end."
                ),
                payload={
                    "action": "update_status",
                    "lead_id": r["lead_id"],
                    "new_status": "dead",
                    "reason": "No contactable phone numbers",
                },
                priority="medium",
            )
        self.log(f"Found {len(rows)} uncontactable leads")

    # ------------------------------------------------------------------
    # 4. Archive dead weight (bulk)
    # ------------------------------------------------------------------
    def _archive_dead_weight(self) -> None:
        self.log("Checking for old dead leads to archive")
        row = self.query_one(
            """
            SELECT COUNT(*) AS cnt
            FROM leads
            WHERE status = 'dead'
              AND julianday('now') - julianday(updated_at) > 90
            """,
        )
        count = row["cnt"] if row else 0
        if count > 10:
            self.create_proposal(
                title=f"Archive {count} dead leads (90+ days old)",
                description=(
                    f"There are {count} leads that have been dead for over 90 days. "
                    f"Archiving them keeps the pipeline clean without losing data."
                ),
                payload={
                    "action": "bulk_update_status",
                    "from_status": "dead",
                    "new_status": "archived",
                    "older_than_days": 90,
                    "reason": "Bulk archive: dead > 90 days",
                },
                priority="low",
            )
            self.log(f"Proposed bulk archive for {count} dead leads")
        else:
            self.log(f"Only {count} old dead leads — below threshold, skipping")

    # ------------------------------------------------------------------
    # 5. Stale proposal cleanup
    # ------------------------------------------------------------------
    def _stale_proposal_cleanup(self) -> None:
        self.log("Checking for stale pending proposals")
        row = self.query_one(
            """
            SELECT COUNT(*) AS cnt
            FROM proposals
            WHERE status = 'pending'
              AND julianday('now') - julianday(created_at) > 7
            """,
        )
        count = row["cnt"] if row else 0
        if count > 10:
            # Grab the IDs for the payload
            stale = self.query(
                """
                SELECT id
                FROM proposals
                WHERE status = 'pending'
                  AND julianday('now') - julianday(created_at) > 7
                """,
            )
            stale_ids = [r["id"] for r in stale]
            self.create_proposal(
                title=f"Clean up {count} stale proposals (7+ days old)",
                description=(
                    f"{count} proposals have been sitting pending for over a week. "
                    f"If nobody acted on them they're probably irrelevant now. "
                    f"Deny them in bulk to clear the queue."
                ),
                payload={
                    "action": "consolidate_and_deny",
                    "deny_proposal_ids": stale_ids,
                    "reason": "Stale proposals — pending over 7 days",
                },
                priority="low",
            )
            self.log(f"Proposed cleanup for {count} stale proposals")
        else:
            self.log(f"Only {count} stale proposals — below threshold, skipping")
