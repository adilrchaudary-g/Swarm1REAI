"""Discord webhook notifications — posts sets, recordings, stats, and hot leads.

Pure stdlib (urllib.request). No discord.py dependency at runtime.
Reads webhook URLs from environment variables set during discord_setup.
All functions are safe to call from background threads and never raise.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .store import HermesStore

# ── Embed colors ──────────────────────────────────────────────────

COLOR_GREEN = 0x22C55E
COLOR_AMBER = 0xEAB308
COLOR_RED = 0xEF4444
COLOR_BLUE = 0x3B82F6
COLOR_ORANGE = 0xF97316

SCORE_COLORS = {
    "Strong": COLOR_GREEN,
    "Average": COLOR_AMBER,
    "Needs Work": COLOR_RED,
}


# ── Webhook transport ────────────────────────────────────────────

def _post_webhook(url: str, payload: dict, file_path: str | None = None) -> bool:
    if not url:
        return False
    try:
        if file_path and Path(file_path).is_file():
            return _post_webhook_multipart(url, payload, file_path)

        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            url, data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Hermes/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 429:
                retry_after = float(resp.headers.get("Retry-After", "5"))
                time.sleep(min(retry_after, 30))
                return _post_webhook(url, payload)
            return resp.status in (200, 204)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = float(e.headers.get("Retry-After", "5"))
            time.sleep(min(retry_after, 30))
            return _post_webhook(url, payload)
        print(f"[discord] Webhook POST failed ({e.code}): {e.reason}")
        return False
    except Exception as exc:
        print(f"[discord] Webhook POST error: {exc}")
        return False


def _post_webhook_multipart(url: str, payload: dict, file_path: str) -> bool:
    """POST with file attachment using multipart/form-data."""
    import mimetypes
    boundary = "----HermesWebhookBoundary"
    fp = Path(file_path)
    mime = mimetypes.guess_type(fp.name)[0] or "application/octet-stream"

    body_parts = []
    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(b'Content-Disposition: form-data; name="payload_json"\r\n')
    body_parts.append(b"Content-Type: application/json\r\n\r\n")
    body_parts.append(json.dumps(payload).encode())
    body_parts.append(b"\r\n")

    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(
        f'Content-Disposition: form-data; name="files[0]"; filename="{fp.name}"\r\n'.encode()
    )
    body_parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
    body_parts.append(fp.read_bytes())
    body_parts.append(b"\r\n")
    body_parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(body_parts)
    req = urllib.request.Request(
        url, data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Hermes/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status in (200, 204)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = float(e.headers.get("Retry-After", "5"))
            time.sleep(min(retry_after, 30))
            return _post_webhook_multipart(url, payload, file_path)
        print(f"[discord] Multipart POST failed ({e.code}): {e.reason}")
        return False
    except Exception as exc:
        print(f"[discord] Multipart POST error: {exc}")
        return False


def _webhooks_configured() -> bool:
    return bool(os.environ.get("DISCORD_SETS_WEBHOOK"))


# ── Notification functions ───────────────────────────────────────

def notify_set(store: HermesStore, lead_id: str, caller_name: str) -> None:
    url = os.environ.get("DISCORD_SETS_WEBHOOK")
    if not url:
        return
    try:
        lead = store.get_lead_detail(lead_id)
        if not lead:
            return

        distress = lead.get("distress_signals_json")
        if isinstance(distress, str):
            try:
                distress = json.loads(distress)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(distress, list):
            distress_text = ", ".join(distress[:5]) if distress else "None"
        elif isinstance(distress, str):
            distress_text = distress or "None"
        else:
            distress_text = "None"

        motivation = lead.get("motivation_tier", "Unknown")
        city = lead.get("address_city", "")
        state = lead.get("address_state", "")
        zip_code = lead.get("address_zip", "")
        location = ", ".join(filter(None, [city, state])) + (f" {zip_code}" if zip_code else "")

        payload = {
            "embeds": [{
                "title": "New Set",
                "color": COLOR_GREEN,
                "fields": [
                    {"name": "Owner", "value": lead.get("owner_name", "Unknown"), "inline": True},
                    {"name": "Property", "value": lead.get("address_full", "Unknown"), "inline": True},
                    {"name": "Location", "value": location or "Unknown", "inline": True},
                    {"name": "Caller", "value": caller_name, "inline": True},
                    {"name": "Motivation", "value": motivation, "inline": True},
                    {"name": "Distress", "value": distress_text, "inline": False},
                ],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Hermes"},
            }],
        }
        _post_webhook(url, payload)
        print(f"[discord] Posted set alert for lead {lead_id}")
    except Exception as exc:
        print(f"[discord] notify_set error: {exc}")


def notify_set_appointment(
    store: HermesStore, lead_id: str, caller_name: str,
    appointment_at: str, notes: str,
) -> None:
    """Enhanced set notification with appointment time and notes."""
    url = os.environ.get("DISCORD_SETS_WEBHOOK")
    if not url:
        return
    try:
        lead = store.get_lead_detail(lead_id)
        if not lead:
            return

        distress = lead.get("distress_signals_json")
        if isinstance(distress, str):
            try:
                distress = json.loads(distress)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(distress, list):
            distress_text = ", ".join(distress[:5]) if distress else "None"
        elif isinstance(distress, str):
            distress_text = distress or "None"
        else:
            distress_text = "None"

        motivation = lead.get("motivation_tier", "Unknown")
        city = lead.get("address_city", "")
        state = lead.get("address_state", "")
        zip_code = lead.get("address_zip", "")
        location = ", ".join(filter(None, [city, state])) + (f" {zip_code}" if zip_code else "")

        appt_display = "TBD"
        if appointment_at:
            try:
                from zoneinfo import ZoneInfo
                dt = datetime.fromisoformat(appointment_at.replace("Z", "+00:00"))
                et = dt.astimezone(ZoneInfo("America/New_York"))
                appt_display = et.strftime("%a %b %-d, %-I:%M %p ET")
            except (ValueError, AttributeError):
                appt_display = appointment_at

        fields = [
            {"name": "Owner", "value": lead.get("owner_name", "Unknown"), "inline": True},
            {"name": "Property", "value": lead.get("address_full", "Unknown"), "inline": True},
            {"name": "Location", "value": location or "Unknown", "inline": True},
            {"name": "Appointment", "value": appt_display, "inline": True},
            {"name": "Caller", "value": caller_name, "inline": True},
            {"name": "Motivation", "value": motivation, "inline": True},
        ]
        if distress_text != "None":
            fields.append({"name": "Distress", "value": distress_text, "inline": False})
        if notes:
            excerpt = notes[:300] + ("..." if len(notes) > 300 else "")
            fields.append({"name": "Notes", "value": excerpt, "inline": False})

        payload = {
            "embeds": [{
                "title": "New Set Booked",
                "color": COLOR_GREEN,
                "fields": fields,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Hermes"},
            }],
        }
        _post_webhook(url, payload)
        print(f"[discord] Posted set appointment for lead {lead_id}")
    except Exception as exc:
        print(f"[discord] notify_set_appointment error: {exc}")


def notify_recording_graded(store: HermesStore, rec_id: int) -> None:
    url = os.environ.get("DISCORD_RECORDINGS_WEBHOOK")
    if not url:
        return
    try:
        rec = store.get_call_recording(rec_id)
        if not rec:
            return

        call_score = rec.get("call_score", "Average")
        color = SCORE_COLORS.get(call_score, COLOR_AMBER)

        battle = rec.get("my_performance_json")
        if isinstance(battle, str):
            try:
                battle = json.loads(battle)
            except (json.JSONDecodeError, TypeError):
                battle = {}
        battle = battle or {}

        motivation = rec.get("seller_motivation_json")
        if isinstance(motivation, str):
            try:
                motivation = json.loads(motivation)
            except (json.JSONDecodeError, TypeError):
                motivation = {}
        motivation = motivation or {}

        sentiment = motivation.get("overall_sentiment", "Unknown")
        transcript = (rec.get("transcript") or "")[:300]
        if len(rec.get("transcript") or "") > 300:
            transcript += "..."

        fields = [
            {"name": "Seller", "value": rec.get("seller_name", "Unknown"), "inline": True},
            {"name": "Property", "value": rec.get("property_address", "Unknown"), "inline": True},
            {"name": "Overall", "value": f"{battle.get('overall', '?')}/10", "inline": True},
            {"name": "Objection Handling", "value": f"{battle.get('objection_handling', '?')}/10", "inline": True},
            {"name": "Conversation Control", "value": f"{battle.get('conversation_control', '?')}/10", "inline": True},
            {"name": "Kept on Phone", "value": f"{battle.get('kept_on_phone', '?')}/10", "inline": True},
            {"name": "Stayed Grounded", "value": f"{battle.get('stayed_grounded', '?')}/10", "inline": True},
            {"name": "Seller Motivation", "value": sentiment, "inline": True},
        ]
        if transcript:
            fields.append({"name": "Excerpt", "value": f"_{transcript}_", "inline": False})

        payload = {
            "embeds": [{
                "title": f"Call Graded: {call_score}",
                "color": color,
                "fields": fields,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Hermes"},
            }],
        }

        audio_path = rec.get("file_path")
        _post_webhook(url, payload, file_path=audio_path)
        print(f"[discord] Posted recording grade for {rec_id}: {call_score}")
    except Exception as exc:
        print(f"[discord] notify_recording_graded error: {exc}")


def notify_hot_lead(store: HermesStore, lead_id: str) -> None:
    url = os.environ.get("DISCORD_HOT_LEADS_WEBHOOK")
    if not url:
        return
    try:
        lead = store.get_lead_detail(lead_id)
        if not lead:
            return

        distress = lead.get("distress_signals_json")
        if isinstance(distress, str):
            try:
                distress = json.loads(distress)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(distress, list):
            distress_text = ", ".join(distress[:5]) if distress else "None"
        elif isinstance(distress, str):
            distress_text = distress or "None"
        else:
            distress_text = "None"

        payload = {
            "embeds": [{
                "title": "Hot Lead",
                "color": COLOR_ORANGE,
                "fields": [
                    {"name": "Owner", "value": lead.get("owner_name", "Unknown"), "inline": True},
                    {"name": "Property", "value": lead.get("address_full", "Unknown"), "inline": True},
                    {"name": "Motivation Score", "value": str(lead.get("motivation_score", "?")), "inline": True},
                    {"name": "Distress", "value": distress_text, "inline": False},
                ],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Hermes"},
            }],
        }
        _post_webhook(url, payload)
        print(f"[discord] Posted hot lead alert for {lead_id}")
    except Exception as exc:
        print(f"[discord] notify_hot_lead error: {exc}")


def post_daily_stats(store: HermesStore) -> None:
    """Post end-of-day caller performance summary."""
    url = os.environ.get("DISCORD_DAILY_STATS_WEBHOOK")
    if not url:
        return
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/New_York")
        today = datetime.now(timezone.utc).astimezone(tz)
        date_str = today.strftime("%Y-%m-%d")

        summary = store.get_activity_summary(date_str, date_str)
        if not summary:
            return

        kpis = store.get_tracker_kpis()

        fields = []
        for row in summary:
            name = row.get("caller_name", "Unknown")
            dials = row.get("actual_dials", 0)
            sets = row.get("actual_leads_set", 0)
            hours = row.get("billable_hours", 0)
            span = row.get("actual_span_hours", 0)
            flags = row.get("integrity_flags", [])

            first_call = row.get("first_call", "")
            last_call = row.get("last_call", "")
            try:
                t1 = datetime.fromisoformat(first_call).strftime("%-I:%M %p")
                t2 = datetime.fromisoformat(last_call).strftime("%-I:%M %p")
                time_range = f"{t1} — {t2} ET"
            except (ValueError, AttributeError):
                time_range = "N/A"

            integrity = "Clean" if not flags or flags == ["no_log_submitted"] else ", ".join(flags)

            caller_lines = [
                f"**{name}** ({time_range})",
                f"Dials: **{dials}** | Sets: **{sets}** | Hours: **{hours}**h (span: {span:.1f}h)",
                f"Integrity: {integrity}",
            ]
            fields.append({
                "name": name,
                "value": "\n".join(caller_lines[1:]),
                "inline": False,
            })

        total_dials = kpis.get("calls_today", 0)
        total_convos = kpis.get("real_convos_today", 0)
        pickup_rate = kpis.get("pickup_rate", 0)

        totals_text = f"Total Dials: **{total_dials}** | Convos: **{total_convos}** | Pickup Rate: **{pickup_rate}%**"

        payload = {
            "embeds": [{
                "title": f"Daily Stats — {today.strftime('%a %b %-d')}",
                "color": COLOR_BLUE,
                "description": totals_text,
                "fields": fields,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Hermes EOD Report"},
            }],
        }
        _post_webhook(url, payload)
        print(f"[discord] Posted daily stats for {date_str}")
    except Exception as exc:
        print(f"[discord] post_daily_stats error: {exc}")


def start_daily_scheduler(store: HermesStore) -> None:
    """Start a daemon thread that fires post_daily_stats at 6 PM ET daily."""
    if not _webhooks_configured():
        return

    def _scheduler_loop() -> None:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/New_York")
        TARGET_HOUR = 18

        while True:
            try:
                now = datetime.now(timezone.utc).astimezone(tz)
                target = now.replace(hour=TARGET_HOUR, minute=0, second=0, microsecond=0)
                if now >= target:
                    target += timedelta(days=1)
                sleep_seconds = (target - now).total_seconds()
                print(f"[discord] Daily stats scheduled for {target.strftime('%Y-%m-%d %I:%M %p %Z')} ({sleep_seconds:.0f}s)")
                time.sleep(sleep_seconds)
                post_daily_stats(store)
            except Exception as exc:
                print(f"[discord] Scheduler error: {exc}")
                time.sleep(300)

    t = threading.Thread(target=_scheduler_loop, daemon=True, name="discord-daily-stats")
    t.start()
    print("[discord] Daily stats scheduler started")
