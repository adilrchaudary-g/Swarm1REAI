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
- If `origin_channel` or `channel` suggests a land-lane source, the bridge rejects with `OUT_OF_LANE_SCOPE`.

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
  "list_name": "Houston - Vacant Absentee",
  "format": "csv"
}
```

### SKIP_TRACE

```json
{
  "command_type": "SKIP_TRACE",
  "property_ids": ["prop-1", "prop-2"]
}
```

### MONITOR

```json
{
  "command_type": "MONITOR",
  "property_ids": ["prop-1", "prop-2"]
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
- `monitor`

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

## Error codes

The script currently emits:

- `BRIDGE_HALTED`
- `CAPTCHA_REQUIRED`
- `DOM_SELECTOR_MISSING`
- `EXECUTION_TIMEOUT`
- `EXPORT_CAPTURE_PARTIAL`
- `INVALID_COMMAND`
- `OUT_OF_LANE_SCOPE`
- `OUTSIDE_OPERATOR_WINDOW`
- `QUOTA_LOCAL_HALT`
- `QUOTA_REMOTE_EXHAUSTED`
- `RATE_LIMITED`
- `SESSION_EXPIRED`
- `UNKNOWN`

## Skip-trace privacy rule

- Full skip-trace contact payloads go only to Hermes.
- Discord mirrors receive a redacted summary only.
- Rolling logs redact phone numbers, email addresses, and mailing addresses.

## Heartbeat

Heartbeat payloads use the same envelope and include:

- `script_version`
- `uptime_seconds`
- `last_successful_command_at`
- `queue_depth`
- `master_halt`
- `halted_scopes`
- `quota_snapshot`
