"""Supervisor agent — consolidation, pipeline health, daily digest, agent oversight."""

from __future__ import annotations

import json
from collections import defaultdict

from .base import BaseAgent


_OPS_SYSTEM_PROMPT = (
    "You are the operations manager for a solo real estate wholesaler. "
    "Speak in plain English like you're briefing your boss over coffee. "
    "Be specific with numbers. Recommend what to focus on today. "
    "Keep it under 200 words."
)


class SupervisorAgent(BaseAgent):
    agent_type = "supervisor"

    def execute(self) -> None:
        self._consolidate_noise()
        self._pipeline_health()
        self._daily_ops_digest()
        self._agent_performance()

    # ------------------------------------------------------------------
    # 1. Consolidate noisy proposals from other agents
    # ------------------------------------------------------------------
    def _consolidate_noise(self) -> None:
        self.log("Looking for noisy proposal patterns to consolidate")
        pending = self.query(
            """
            SELECT id, agent_type, title, created_at
            FROM proposals
            WHERE status = 'pending'
              AND agent_type != 'supervisor'
            ORDER BY created_at DESC
            """,
        )
        if not pending:
            self.log("No pending proposals from other agents")
            return

        # Group by normalized title pattern (strip trailing specifics after colon)
        groups: dict[str, list[dict]] = defaultdict(list)
        for p in pending:
            # Normalize: take everything before the last colon as pattern key
            title = p["title"]
            if ":" in title:
                pattern = title.rsplit(":", 1)[0].strip()
            else:
                pattern = title.strip()
            groups[pattern].append(p)

        consolidated = 0
        for pattern, proposals in groups.items():
            if len(proposals) < 5:
                continue

            deny_ids = [p["id"] for p in proposals]
            agent = proposals[0]["agent_type"]
            count = len(proposals)
            consolidated += count

            desc = (
                f"The {agent} agent created {count} proposals all matching "
                f"'{pattern}'. That's noise — consolidating into one action."
            )
            ai_desc = self.call_claude(
                f"Rewrite this proposal description in plain conversational English "
                f"for a busy wholesaler:\n\n{desc}\n\nFacts: {count} proposals, "
                f"pattern='{pattern}', agent={agent}",
                system=_OPS_SYSTEM_PROMPT,
            )

            self.create_proposal(
                title=f"Consolidate {count}x '{pattern}' proposals",
                description=ai_desc or desc,
                payload={
                    "action": "consolidate_and_deny",
                    "deny_proposal_ids": deny_ids,
                    "reason": f"Consolidated {count} noisy '{pattern}' proposals",
                    "original_pattern": pattern,
                    "original_agent": agent,
                },
                priority="medium",
            )

        self.log(f"Consolidated {consolidated} noisy proposals")

    # ------------------------------------------------------------------
    # 2. Pipeline health check
    # ------------------------------------------------------------------
    def _pipeline_health(self) -> None:
        self.log("Running pipeline health check")
        rows = self.query(
            """
            SELECT status, COUNT(*) AS cnt
            FROM leads
            WHERE status NOT IN ('dead','archived')
            GROUP BY status
            """,
        )
        funnel = {r["status"]: r["cnt"] for r in rows}
        total = sum(funnel.values())

        # Expected mid-funnel stages (order matters for reporting)
        expected_stages = [
            "new", "enriched", "scored", "queued",
            "contacted", "interested", "underwriting",
        ]

        empty_stages = [s for s in expected_stages if funnel.get(s, 0) == 0]

        if not empty_stages:
            self.log(f"Pipeline healthy: {total} active leads across {len(funnel)} stages")
            return

        # Build description
        funnel_summary = ", ".join(
            f"{s}: {funnel.get(s, 0)}" for s in expected_stages
        )
        raw_desc = (
            f"Pipeline bottleneck detected. These stages have ZERO leads: "
            f"{', '.join(empty_stages)}. Current funnel: {funnel_summary}. "
            f"Total active: {total}."
        )
        ai_desc = self.call_claude(
            f"Write a brief alert about this pipeline issue for a solo wholesaler:\n\n"
            f"{raw_desc}",
            system=_OPS_SYSTEM_PROMPT,
        )

        self.create_proposal(
            title=f"Pipeline bottleneck: {', '.join(empty_stages)} empty",
            description=ai_desc or raw_desc,
            payload={
                "action": "add_note",
                "note": f"Pipeline alert: {', '.join(empty_stages)} stages are empty",
                "display_type": "alert",
                "funnel": funnel,
                "empty_stages": empty_stages,
            },
            priority="high",
        )
        self.log(f"Flagged {len(empty_stages)} empty pipeline stages")

    # ------------------------------------------------------------------
    # 3. Daily ops digest
    # ------------------------------------------------------------------
    def _daily_ops_digest(self) -> None:
        self.log("Building daily operations digest")

        # Lead counts by status
        status_rows = self.query(
            """
            SELECT status, COUNT(*) AS cnt
            FROM leads
            WHERE status NOT IN ('dead','archived')
            GROUP BY status
            """,
        )
        funnel = {r["status"]: r["cnt"] for r in status_rows}

        # Source quality
        source_rows = self.query(
            """
            SELECT source,
                   COUNT(*) AS total,
                   SUM(CASE WHEN EXISTS(
                       SELECT 1 FROM owner_phones op WHERE op.owner_id = l.owner_id
                   ) THEN 1 ELSE 0 END) AS with_phone
            FROM leads l
            WHERE status NOT IN ('dead','archived')
            GROUP BY source
            """,
        )
        sources = {
            r["source"]: {
                "total": r["total"],
                "with_phone": r["with_phone"],
                "phone_rate": (
                    round(r["with_phone"] / r["total"] * 100)
                    if r["total"] > 0 else 0
                ),
            }
            for r in source_rows
        }

        # Pending proposals
        pending_row = self.query_one(
            "SELECT COUNT(*) AS cnt FROM proposals WHERE status = 'pending'",
        )
        pending_proposals = pending_row["cnt"] if pending_row else 0

        # Follow-up stats
        followup_row = self.query_one(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS pending,
                   SUM(CASE WHEN completed_at IS NULL AND scheduled_at < datetime('now')
                       THEN 1 ELSE 0 END) AS overdue
            FROM follow_ups
            """,
        )
        follow_ups = {
            "total": followup_row["total"] if followup_row else 0,
            "pending": followup_row["pending"] if followup_row else 0,
            "overdue": followup_row["overdue"] if followup_row else 0,
        }

        # Call recording stats
        call_row = self.query_one(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN created_at > datetime('now', '-7 days')
                       THEN 1 ELSE 0 END) AS last_7d
            FROM call_recordings
            """,
        )
        calls = {
            "total": call_row["total"] if call_row else 0,
            "last_7d": call_row["last_7d"] if call_row else 0,
        }

        # Build the data package
        data = {
            "funnel": funnel,
            "total_active": sum(funnel.values()),
            "sources": sources,
            "pending_proposals": pending_proposals,
            "follow_ups": follow_ups,
            "calls": calls,
        }

        # Build human-readable summary
        funnel_lines = ", ".join(f"{s}: {c}" for s, c in sorted(funnel.items()))
        source_lines = "; ".join(
            f"{s}: {v['total']} leads ({v['phone_rate']}% have phones)"
            for s, v in sources.items()
        )
        raw_content = (
            f"Daily Digest\n"
            f"Active leads: {data['total_active']} ({funnel_lines})\n"
            f"Sources: {source_lines}\n"
            f"Pending proposals: {pending_proposals}\n"
            f"Follow-ups: {follow_ups['pending']} pending, {follow_ups['overdue']} overdue\n"
            f"Calls: {calls['last_7d']} in last 7 days, {calls['total']} total"
        )

        ai_content = self.call_claude(
            f"Write a daily operations brief from this data:\n\n{raw_content}\n\n"
            f"Raw data:\n{json.dumps(data, indent=2)}",
            system=_OPS_SYSTEM_PROMPT,
        )

        content = ai_content or raw_content

        self.create_proposal(
            title="Daily operations digest",
            description=content,
            payload={
                "action": "daily_digest",
                "display_type": "digest",
                "content": content,
                "data": data,
            },
            priority="low",
        )
        self.log("Daily digest proposal created")

    # ------------------------------------------------------------------
    # 4. Agent performance review
    # ------------------------------------------------------------------
    def _agent_performance(self) -> None:
        self.log("Reviewing agent proposal performance (last 7 days)")
        rows = self.query(
            """
            SELECT agent_type, status, COUNT(*) AS cnt
            FROM proposals
            WHERE created_at > datetime('now', '-7 days')
            GROUP BY agent_type, status
            """,
        )
        if not rows:
            self.log("No proposals in the last 7 days to review")
            return

        # Build per-agent stats
        agents: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for r in rows:
            agents[r["agent_type"]][r["status"]] = r["cnt"]

        flagged = []
        for agent, stats in agents.items():
            total = sum(stats.values())
            denied = stats.get("denied", 0)
            if total >= 5 and denied / total > 0.80:
                rate = round(denied / total * 100)
                flagged.append({
                    "agent": agent,
                    "total": total,
                    "denied": denied,
                    "denial_rate": rate,
                })

        if not flagged:
            self.log("All agents performing within acceptable range")
            return

        # Build summary
        summary_parts = []
        for f in flagged:
            summary_parts.append(
                f"{f['agent']}: {f['denial_rate']}% denial rate "
                f"({f['denied']}/{f['total']} proposals denied)"
            )
        raw_desc = (
            f"Agent performance alert (last 7 days). These agents have >80% "
            f"denial rates:\n" + "\n".join(summary_parts) +
            "\n\nThis means they're creating proposals that don't get approved. "
            "Their logic may need tuning."
        )

        # Full stats for context
        all_stats = {
            agent: dict(stats) for agent, stats in agents.items()
        }

        ai_desc = self.call_claude(
            f"Write a brief performance alert for the wholesaler about their "
            f"AI agents:\n\n{raw_desc}\n\nFull stats: {json.dumps(all_stats)}",
            system=_OPS_SYSTEM_PROMPT,
        )

        self.create_proposal(
            title=f"Agent performance alert: {len(flagged)} agent(s) underperforming",
            description=ai_desc or raw_desc,
            payload={
                "action": "add_note",
                "note": f"Agent performance alert: {', '.join(f['agent'] for f in flagged)}",
                "display_type": "alert",
                "flagged_agents": flagged,
                "all_stats": all_stats,
            },
            priority="medium",
        )
        self.log(f"Flagged {len(flagged)} underperforming agents")
