from __future__ import annotations

import csv
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from hermes.store import HermesStore


def make_envelope(
    *,
    message_id: str,
    envelope_type: str,
    command_type: str,
    status: str = "success",
    items: list[dict] | None = None,
    errors: list[dict] | None = None,
    correlation_id: str | None = None,
    quota_snapshot: dict | None = None,
) -> dict:
    return {
        "envelope_version": "1.0",
        "message_id": message_id,
        "timestamp": "2026-04-29T12:00:00+00:00",
        "source": "userscript" if envelope_type != "command" else "swarm",
        "lane": "houses",
        "type": envelope_type,
        "correlation_id": correlation_id,
        "payload": {
            "command_type": command_type,
            "status": status,
            "items": items or [],
            "errors": errors or [],
            "quota_snapshot": quota_snapshot
            or {
                "saves_used": 1,
                "saves_cap": 42000,
                "exports_used": 1,
                "exports_cap": 40000,
                "skip_traces_used": 1,
                "skip_traces_cap": 40000,
                "monitored_used": 0,
                "monitored_cap": 45000,
            },
        },
    }


class HermesStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "hermes"
        self.store = HermesStore(self.root)
        self.store.initialize()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.store.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_search_ingests_raw_and_projected_rows(self) -> None:
        envelope = make_envelope(
            message_id="search-result-1",
            envelope_type="result",
            command_type="SEARCH",
            items=[
                {
                    "property_id": "prop-live-1",
                    "address_full": "123 Main St, Austin, TX, 78701",
                    "address_street": "123 Main St",
                    "address_city": "Austin",
                    "address_state": "TX",
                    "address_zip": "78701",
                    "parcel_number": "APN-001",
                    "property_type": "single_family_residence_detached",
                    "owner_name": "Jane Seller",
                    "owner_type": "individual",
                    "distress_signals": ["tax_delinquent"],
                    "lead_lifecycle_state": "new",
                }
            ],
        )
        self.store.ingest_envelope(envelope)

        with self._connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM bridge_events").fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM properties").fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM owners").fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0],
                1,
            )
            lead = conn.execute("SELECT status FROM leads").fetchone()
            self.assertEqual(lead["status"], "new")

    def test_export_persists_artifact_and_searches_contacts(self) -> None:
        command = {
            "envelope_version": "1.0",
            "message_id": "export-command-1",
            "timestamp": "2026-04-29T11:59:00+00:00",
            "source": "swarm",
            "lane": "houses",
            "type": "command",
            "correlation_id": None,
            "payload": {"command_type": "EXPORT", "list_name": "Demo List"},
        }
        self.store.ingest_envelope(command)

        csv_path = self.root / "sample.csv"
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                [
                    "Address",
                    "City",
                    "State",
                    "Zip",
                    "APN",
                    "Property Type",
                    "Bedrooms",
                    "Total Bathrooms",
                    "Building Sqft",
                    "Lot Size Sqft",
                    "Effective Year Built",
                    "Total Assessed Value",
                    "Last Sale Recording Date",
                    "Last Sale Amount",
                    "Owner 1 First Name",
                    "Owner 1 Last Name",
                    "Owner Occupied",
                    "Mailing Address",
                    "Mailing City",
                    "Mailing State",
                    "Mailing Zip",
                    "Phone 1",
                    "Phone 1 Type",
                    "Phone 1 DNC",
                    "Email 1",
                    "Litigator",
                    "MLS Status",
                    "Est. Value",
                    "Est. Equity",
                    "Est. Loan-to-Value",
                    "Foreclosure Factor",
                    "Skip Traces",
                ]
            )
            writer.writerow(
                [
                    "500 Oak St",
                    "Dallas",
                    "TX",
                    "75201",
                    "APN-500",
                    "Single Family",
                    "3",
                    "2",
                    "1500",
                    "5000",
                    "1988",
                    "280000",
                    "2020-03-31",
                    "190000",
                    "John",
                    "Owner",
                    "No",
                    "500 Oak Ave",
                    "Plano",
                    "TX",
                    "75024",
                    "555-111-2222",
                    "mobile",
                    "No",
                    "john@example.com",
                    "No",
                    "Expired",
                    "320000",
                    "130000",
                    "60",
                    "Medium Low",
                    "1",
                ]
            )

        envelope = make_envelope(
            message_id="export-result-1",
            envelope_type="result",
            command_type="EXPORT",
            correlation_id="export-command-1",
            items=[],
        )
        self.store.ingest_envelope(envelope, export_csv_path=str(csv_path))

        stored_files = list(self.store.exports_dir.glob("*.csv"))
        self.assertEqual(len(stored_files), 1)
        with self._connect() as conn:
            artifact = conn.execute("SELECT path FROM bridge_artifacts").fetchone()
            self.assertEqual(Path(artifact["path"]).name, stored_files[0].name)
            phone = conn.execute("SELECT phone_type, dnc FROM owner_phones").fetchone()
            self.assertEqual(phone["phone_type"], "mobile")
            self.assertEqual(phone["dnc"], 0)

        lead_results = self.store.query_leads("500 Oak", limit=5)
        self.assertEqual(len(lead_results), 1)
        self.assertEqual(lead_results[0]["address_full"], "500 Oak St, Dallas, TX, 75201")
        self.assertTrue(self.store.query_leads("APN-500", limit=5))
        self.assertTrue(self.store.query_leads("john@example.com", limit=5))
        self.assertTrue(self.store.query_leads("1112222", limit=5))

    def test_skip_trace_updates_enriched_and_preserves_dnc(self) -> None:
        search = make_envelope(
            message_id="search-result-2",
            envelope_type="result",
            command_type="SEARCH",
            items=[
                {
                    "property_id": "live-row-22",
                    "address_full": "22 Cedar St, Houston, TX, 77001",
                    "address_street": "22 Cedar St",
                    "address_city": "Houston",
                    "address_state": "TX",
                    "address_zip": "77001",
                    "owner_name": "Sam Demo",
                    "mailing_address": "22 Cedar St, Houston, TX, 77001",
                }
            ],
        )
        self.store.ingest_envelope(search)
        envelope = make_envelope(
            message_id="skip-result-1",
            envelope_type="result",
            command_type="SKIP_TRACE",
            items=[
                {
                    "property_id": "live-row-22",
                    "phone_numbers": [
                        {"value": "555-999-0000", "type": "landline", "dnc": True}
                    ],
                    "email_addresses": ["sam@example.com"],
                    "contacts_returned": 2,
                }
            ],
        )
        self.store.ingest_envelope(envelope)

        with self._connect() as conn:
            phone = conn.execute("SELECT phone_type, dnc FROM owner_phones").fetchone()
            self.assertEqual(phone["phone_type"], "landline")
            self.assertEqual(phone["dnc"], 1)
            lead = conn.execute("SELECT status FROM leads").fetchone()
            self.assertEqual(lead["status"], "enriched")

    def test_duplicate_event_is_idempotent(self) -> None:
        envelope = make_envelope(
            message_id="search-result-dup",
            envelope_type="result",
            command_type="SEARCH",
            items=[
                {
                    "property_id": "dup-prop",
                    "address_full": "1 Test St, Austin, TX, 78701",
                    "address_street": "1 Test St",
                    "address_city": "Austin",
                    "address_state": "TX",
                    "address_zip": "78701",
                }
            ],
        )
        first = self.store.ingest_envelope(envelope)
        second = self.store.ingest_envelope(envelope)
        self.assertEqual(first["status"], "ingested")
        self.assertEqual(second["status"], "duplicate")
        with self._connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM bridge_events").fetchone()[0],
                1,
            )

    def test_query_commands_and_bridge_issues_and_discord_refs(self) -> None:
        self.store.ingest_envelope(
            make_envelope(
                message_id="search-result-3",
                envelope_type="result",
                command_type="SEARCH",
                items=[
                    {
                        "property_id": "queue-row",
                        "address_full": "9 Queue St, Miami, FL, 33101",
                        "address_street": "9 Queue St",
                        "address_city": "Miami",
                        "address_state": "FL",
                        "address_zip": "33101",
                        "owner_name": "Queue Owner",
                        "motivation_score": 92,
                        "motivation_tier": "hot",
                    }
                ],
            )
        )
        self.store.ingest_envelope(
            make_envelope(
                message_id="error-result-1",
                envelope_type="error",
                command_type="SEARCH",
                status="failure",
                errors=[
                    {
                        "code": "SESSION_EXPIRED",
                        "message": "Session expired",
                        "item_ref": "queue-row",
                    }
                ],
            )
        )
        queue = self.store.query_queue("hot", limit=10)
        self.assertEqual(len(queue), 1)
        outstanding = self.store.query_outstanding("bridge", limit=10)
        self.assertEqual(outstanding[0]["code"], "SESSION_EXPIRED")

        lead = self.store.query_leads("Queue Owner", limit=1)[0]
        recorded = self.store.record_discord_ref(
            guild_id="g1",
            channel_id="c1",
            thread_id="t1",
            message_id="m1",
            lead_id=lead["lead_id"],
            event_message_id="search-result-3",
            query_text="lead Queue Owner",
        )
        self.assertEqual(recorded["status"], "recorded")

        with self._connect() as conn:
            row = conn.execute("SELECT lead_id, event_message_id FROM discord_refs").fetchone()
            self.assertEqual(row["lead_id"], lead["lead_id"])
            self.assertEqual(row["event_message_id"], "search-result-3")


if __name__ == "__main__":
    unittest.main()
