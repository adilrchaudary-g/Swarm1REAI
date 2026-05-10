from __future__ import annotations

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path

from hermes.server import serve_in_thread


class HermesServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "hermes"
        self.runtime, self.server, self.thread = serve_in_thread(self.root, port=0)
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.temp_dir.cleanup()

    def _post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))

    def _get(self, path: str) -> dict | list:
        with urllib.request.urlopen(self.base_url + path) as response:
            return json.loads(response.read().decode("utf-8"))

    def test_runtime_endpoints(self) -> None:
        command = {
            "envelope_version": "1.0",
            "message_id": "cmd-1",
            "timestamp": "2026-04-29T12:00:00+00:00",
            "source": "swarm",
            "lane": "houses",
            "type": "command",
            "correlation_id": None,
            "payload": {"command_type": "PING"},
        }
        queued = self._post("/commands", command)
        self.assertEqual(queued["status"], "queued")

        polled = self._get("/bridge/poll?lane=houses")
        self.assertEqual(len(polled), 1)
        self.assertEqual(polled[0]["message_id"], "cmd-1")

        event = {
            "envelope_version": "1.0",
            "message_id": "evt-1",
            "timestamp": "2026-04-29T12:01:00+00:00",
            "source": "userscript",
            "lane": "houses",
            "type": "result",
            "correlation_id": None,
            "payload": {
                "command_type": "SEARCH",
                "status": "success",
                "items": [
                    {
                        "property_id": "srv-1",
                        "address_full": "77 Server St, Tampa, FL, 33602",
                        "address_street": "77 Server St",
                        "address_city": "Tampa",
                        "address_state": "FL",
                        "address_zip": "33602",
                        "owner_name": "Server Owner",
                    }
                ],
                "errors": [],
                "quota_snapshot": {
                    "saves_used": 0,
                    "saves_cap": 42000,
                    "exports_used": 0,
                    "exports_cap": 40000,
                    "skip_traces_used": 0,
                    "skip_traces_cap": 40000,
                    "monitored_used": 0,
                    "monitored_cap": 45000,
                },
            },
        }
        ingested = self._post("/bridge/events", event)
        self.assertEqual(ingested["status"], "ingested")

        handled = self._post(
            "/discord/command",
            {
                "text": "@alfred lead Server Owner",
                "message_id": "discord-msg-1",
                "guild_id": "g1",
                "channel_id": "c1",
                "thread_id": "t1",
            },
        )
        self.assertEqual(handled["status"], "ok")
        self.assertIn("Server Owner", handled["response"])


if __name__ == "__main__":
    unittest.main()
