#!/usr/bin/env bash
# test-webhook.sh
#
# Verifies a Discord webhook URL works by sending a heartbeat-shaped test message.
# Run this BEFORE wiring a webhook into the userscript so you know it's valid.
#
# Usage:
#   ./scripts/test-webhook.sh <webhook-url>
#
# Or set the URL as an environment variable:
#   WEBHOOK_URL=https://discord.com/api/webhooks/... ./scripts/test-webhook.sh

set -euo pipefail

WEBHOOK_URL="${1:-${WEBHOOK_URL:-}}"

if [ -z "$WEBHOOK_URL" ]; then
  echo "Error: webhook URL required."
  echo "Usage: $0 <webhook-url>"
  echo "   or: WEBHOOK_URL=... $0"
  exit 1
fi

if [[ ! "$WEBHOOK_URL" =~ ^https://(discord|discordapp)\.com/api/webhooks/ ]]; then
  echo "Error: URL doesn't look like a Discord webhook."
  echo "Expected format: https://discord.com/api/webhooks/<id>/<token>"
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HOSTNAME=$(hostname)

PAYLOAD=$(cat <<EOF
{
  "content": "**Webhook test** — $TIMESTAMP from $HOSTNAME",
  "embeds": [{
    "title": "Connectivity check",
    "description": "If you can see this message, the webhook is live and the userscript can post here.",
    "color": 5763719,
    "fields": [
      {"name": "envelope_version", "value": "1.0", "inline": true},
      {"name": "type", "value": "heartbeat", "inline": true},
      {"name": "lane", "value": "houses", "inline": true},
      {"name": "source", "value": "test-webhook.sh", "inline": true}
    ],
    "footer": {"text": "Delete this message after verifying."}
  }]
}
EOF
)

echo "Posting test payload to webhook..."
HTTP_CODE=$(curl -s -o /tmp/webhook-response.txt -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "$PAYLOAD" \
  "$WEBHOOK_URL")

if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
  echo "Success — HTTP $HTTP_CODE. Check the Discord channel for the test message."
  exit 0
else
  echo "Failed — HTTP $HTTP_CODE"
  echo "Response body:"
  cat /tmp/webhook-response.txt
  echo
  exit 1
fi
