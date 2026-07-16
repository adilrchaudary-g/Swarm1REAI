"""Carrier adapter seam (spec §6).

The power-dialer orchestrator imports ONLY the CarrierAdapter interface and the
CarrierEvent type — never a concrete carrier SDK. All Twilio specifics live in
TwilioCarrierAdapter. Swapping to Telnyx later = one new class, zero orchestrator
changes.

amd_screen model: originate with async AMD. Twilio answers the lead and parks it
(hold audio) while AMD runs in parallel; the AMD result arrives as a separate
`amd_result` event, so the ORCHESTRATOR decides whether to bridge (human) or hang
up (machine). The agent hears nothing until a human is confirmed.
"""
from __future__ import annotations

import base64
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

LegHandle = str          # Twilio Call SID
ConferenceId = str       # Twilio conference name


@dataclass
class CarrierEvent:
    """Normalized carrier event (spec §6). `leg_id` is the carrier call id (SID)."""
    leg_id: LegHandle
    type: str                       # initiated | ringing | answered | amd_result | hangup
    amd: str | None = None          # human | machine | ivr | unknown | fax  (amd_result only)
    sip_cause: str | None = None
    at: str = ""


class CarrierAdapter(ABC):
    """The only carrier surface the orchestrator may touch (spec §6)."""

    def __init__(self) -> None:
        self._handler: Callable[[CarrierEvent], None] | None = None

    @abstractmethod
    def originate(self, *, to: str, from_did: str, agent_id: str,
                  amd: bool, ring_timeout_s: int, leg_ref: str) -> LegHandle | None:
        """Fire ONE outbound leg. `amd=True` only in amd_screen mode. Returns the
        carrier call id, or None on failure (orchestrator treats None as `failed`)."""

    @abstractmethod
    def hangup(self, leg: LegHandle) -> bool:
        """Idempotent hang-up (no-op on an already-dead leg)."""

    @abstractmethod
    def bridge_to_conference(self, leg: LegHandle, conf: ConferenceId) -> bool:
        """Move a live (parked) leg into the agent's conference — the 'connect'."""

    @abstractmethod
    def create_conference(self, agent_id: str) -> ConferenceId:
        """Return the agent's conference id (created lazily on first join)."""

    @abstractmethod
    def join_agent(self, agent_id: str, conf: ConferenceId) -> LegHandle | None:
        """Bring the agent into their conference once, at block start."""

    def list_owned_numbers(self) -> list[str]:
        """E.164 caller IDs this account can originate from (for local-presence
        rotation, PD-7). Default: none — subclasses that own DIDs override."""
        return []

    # ── event fan-in (webhooks call dispatch()) ──────────────────
    def on_event(self, handler: Callable[[CarrierEvent], None]) -> None:
        self._handler = handler

    def dispatch(self, event: CarrierEvent) -> None:
        if self._handler:
            self._handler(event)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TwilioCarrierAdapter(CarrierAdapter):
    """Twilio Call Control implementation. Self-contained REST (no SDK), so the
    'no carrier SDK outside the adapter' rule holds. Reads TWILIO_* from env and
    PUBLIC_BASE_URL for its webhooks (the stable api.swarmdispo.com tunnel)."""

    def __init__(self, base_url: str | None = None) -> None:
        super().__init__()
        self.account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
        self.auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
        self.default_from = os.environ.get("TWILIO_PHONE_NUMBER", "").strip()
        self.base_url = (base_url or os.environ.get("PUBLIC_BASE_URL", "")).strip().rstrip("/")

    # ── low-level Twilio REST (encapsulated) ─────────────────────
    def _api(self, path: str, params: dict[str, object]) -> dict | None:
        import urllib.request
        import urllib.parse
        import urllib.error
        if not (self.account_sid and self.auth_token):
            return None
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}{path}"
        data = urllib.parse.urlencode(params, doseq=True).encode()
        auth = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        req = urllib.request.Request(url, data=data, headers={"Authorization": f"Basic {auth}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                return {"_error": json.loads(exc.read().decode("utf-8"))}
            except Exception:
                return {"_error": {"status": exc.code}}
        except (urllib.error.URLError, OSError):
            return None

    @staticmethod
    def _esc(s: str) -> str:
        return (s.replace("&", "&amp;").replace("<", "&lt;")
                 .replace(">", "&gt;").replace('"', "&quot;"))

    # ── interface ────────────────────────────────────────────────
    def originate(self, *, to: str, from_did: str, agent_id: str,
                  amd: bool, ring_timeout_s: int, leg_ref: str) -> LegHandle | None:
        import urllib.parse
        q = urllib.parse.urlencode({"leg": leg_ref})
        params: dict[str, object] = {
            "To": to,
            "From": from_did or self.default_from,
            # Answered lead is PARKED here (hold) until the orchestrator bridges it.
            "Url": f"{self.base_url}/pd/answer?{q}",
            "Method": "POST",
            "StatusCallback": f"{self.base_url}/pd/status?{q}",
            "StatusCallbackMethod": "POST",
            "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
            "Timeout": str(ring_timeout_s),
            # Record the whole call (survives the redirect into the agent conference,
            # so it captures the full agent<->lead conversation). No announcement is
            # played — Record=true on a REST call is silent by design. On completion
            # Twilio POSTs the recording to /pd/recording, which downloads it locally
            # and deletes the Twilio-side copy.
            "Record": "true",
            "RecordingStatusCallback": f"{self.base_url}/pd/recording?{q}",
            "RecordingStatusCallbackMethod": "POST",
            "RecordingStatusCallbackEvent": "completed",
        }
        if amd:
            # Async AMD: lead answers + parks immediately; AMD posts its verdict to
            # /pd/amd, which the orchestrator turns into a bridge-or-hangup decision.
            params["MachineDetection"] = "Enable"
            params["AsyncAmd"] = "true"
            params["AsyncAmdStatusCallback"] = f"{self.base_url}/pd/amd?{q}"
            params["AsyncAmdStatusCallbackMethod"] = "POST"
            params["MachineDetectionTimeout"] = "12"
        resp = self._api("/Calls.json", params)
        if resp and resp.get("sid"):
            return resp["sid"]
        return None

    def hangup(self, leg: LegHandle) -> bool:
        if not leg:
            return True  # idempotent no-op
        resp = self._api(f"/Calls/{leg}.json", {"Status": "completed"})
        return bool(resp and not resp.get("_error"))

    def bridge_to_conference(self, leg: LegHandle, conf: ConferenceId) -> bool:
        if not leg:
            return False
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Response><Dial><Conference startConferenceOnEnter="false" '
            f'endConferenceOnExit="false" beep="false">{self._esc(conf)}'
            "</Conference></Dial></Response>"
        )
        resp = self._api(f"/Calls/{leg}.json", {"Twiml": twiml})
        return bool(resp and not resp.get("_error"))

    def create_conference(self, agent_id: str) -> ConferenceId:
        return f"pd-agent-{agent_id}"

    def join_agent(self, agent_id: str, conf: ConferenceId) -> LegHandle | None:
        # Ring the agent's browser client once; the answer TwiML drops them into
        # the conference where they wait (warm) for the whole block.
        import urllib.parse
        q = urllib.parse.urlencode({"conf": conf})
        resp = self._api("/Calls.json", {
            "To": f"client:user_{agent_id}",
            "From": self.default_from,
            "Url": f"{self.base_url}/pd/agent-join?{q}",
            "Method": "POST",
        })
        if resp and resp.get("sid"):
            return resp["sid"]
        return None

    def list_owned_numbers(self) -> list[str]:
        """GET the account's IncomingPhoneNumbers so the dialer can rotate caller
        ID by area code (local presence). Best-effort — [] if the account/creds
        are unset or Twilio is unreachable."""
        import urllib.request
        import urllib.error
        if not (self.account_sid and self.auth_token):
            return []
        url = (f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}"
               "/IncomingPhoneNumbers.json?PageSize=1000")
        auth = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError):
            return []
        return [n["phone_number"] for n in (data.get("incoming_phone_numbers") or [])
                if n.get("phone_number")]
