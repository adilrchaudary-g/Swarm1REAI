# Protocol

This document defines the JSON contract expected by the userscript and Hermes.

## Envelope

```json
{
  "envelope_version": "1.0",
  "message_id": "uuid-v4",
  "timestamp": "ISO8601",
  "source": "swarm",
  "lane": "houses",
  "type": "command",
  "correlation_id": null,
  "payload": {
    "command_type": "SEARCH"
  }
}
```

The bridge emits the same shape back with:

- `source: "userscript"`
- `type: "result" | "error" | "heartbeat"`

## Lane discipline

- `lane` is mandatory.
- Any inbound envelope without `lane: "houses"` is rejected.
- Even though houses is the only active lane today, the bridge keeps `OUT_OF_LANE_SCOPE` behavior so future lanes can be added without changing the protocol contract.

## Command payloads

### SEARCH

```json
{
  "command_type": "SEARCH",
  "zip": "77084",
  "filters": {
    "sfr_detached": true,
    "vacant": true,
    "tax_delinquent": true,
    "min_price": 150000,
    "max_price": 500000
  },
  "max_results": 10
}
```

### SAVE

```json
{
  "command_type": "SAVE",
  "property_ids": ["prop-1", "prop-2"],
  "list_name": "Houston - Vacant Absentee"
}
```

### EXPORT

```json
{
  "command_type": "EXPORT",
  "list_name": "Houston - Vacant Absentee"
}
```

### SKIP_TRACE

```json
{
  "command_type": "SKIP_TRACE",
  "property_ids": ["prop-1", "prop-2"],
  "list_name": "swarm-skiptrace-2026-04-27-a",
  "prefer_batch_route": true
}
```

### QUOTA_CHECK

```json
{
  "command_type": "QUOTA_CHECK"
}
```

### HALT / RESUME

```json
{
  "command_type": "HALT",
  "scope": "all"
}
```

Valid scopes are:

- `all`
- `saves`
- `exports`
- `skip_trace`

### PING

```json
{
  "command_type": "PING"
}
```

## Result payload

```json
{
  "command_type": "SEARCH",
  "status": "success",
  "items": [],
  "errors": [],
  "quota_snapshot": {
    "saves_used": 0,
    "saves_cap": 42000,
    "exports_used": 0,
    "exports_cap": 40000,
    "skip_traces_used": 0,
    "skip_traces_cap": 40000,
    "monitored_used": 0,
    "monitored_cap": 45000
  }
}
```

The `monitored_*` fields stay in the snapshot for observability because PropStream exposes the quota on the account page, even though the v4 userscript does not implement a `MONITOR` command.

## Error codes

The script currently emits:

- `ACTION_NOT_CONFIRMED`
- `BRIDGE_HALTED`
- `CAPTCHA_REQUIRED`
- `DOM_SELECTOR_MISSING`
- `EXECUTION_TIMEOUT`
- `EXPORT_CAPTURE_PARTIAL`
- `INVALID_COMMAND`
- `OUT_OF_LANE_SCOPE`
- `OUTSIDE_OPERATOR_WINDOW`
- `QUOTA_CHECK_REQUIRED`
- `QUOTA_LOCAL_HALT`
- `QUOTA_REMOTE_EXHAUSTED`
- `RATE_LIMITED`
- `SESSION_EXPIRED`
- `UNKNOWN`

## Skip-trace privacy rule

- Full skip-trace contact payloads go only to Hermes.
- Discord mirrors receive a redacted summary only.
- Rolling logs redact phone numbers, email addresses, and mailing addresses.
- Skip-trace extraction must come from an isolated validated modal/panel/container, never from `document.body`.

## Heartbeat

Heartbeat payloads use the same envelope and include:

- `script_version`
- `uptime_seconds`
- `last_successful_command_at`
- `queue_depth`
- `master_halt`
- `halted_scopes`
- `quota_snapshot`
