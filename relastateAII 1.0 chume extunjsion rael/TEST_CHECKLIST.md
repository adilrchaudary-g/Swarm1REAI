# Test Checklist

Run these in order.

## 1. Skeleton + heartbeat

- Install the userscript in TamperMonkey.
- Configure Hermes poll/event URLs and both Discord webhooks.
- Open PropStream and confirm immediate heartbeat POST to Hermes.
- Confirm a compact heartbeat mirror lands in `#house-propstream-results`.

## 2. Quota reader

- Trigger `QUOTA_CHECK`.
- Verify the bridge reaches the usage page and parses current counters.
- Compare counts against the operator's live PropStream account.

## 3. Search + extract

- Send a `SEARCH` command for one known ZIP.
- Limit to `max_results: 10`.
- Verify the returned fields map to canonical schema names.
- Validate that every item includes `lane: "houses"`.

## 4. Single save

- Send a `SAVE` command for one visible property.
- Verify PropStream marks it saved.
- Verify the local save counter increments by 1.
- Retry the same save and confirm idempotent success.

## 5. Single skip trace

- Send a `SKIP_TRACE` command for one property.
- Verify contacts are posted to Hermes.
- Verify Discord receives only the redacted summary.
- Verify nothing sensitive appears in console, rolling log, or control-panel log dump.

## 6. Batch operations

- Run a 10-item `SAVE`.
- Run a 10-item `MONITOR`.
- Run a small batch `SKIP_TRACE`.
- Confirm partial failures return per-item errors instead of aborting the whole batch silently.

## 7. Quota threshold simulation

- Manually set the local counters near 70%, 85%, and 95% of a cap from the panel or storage.
- Trigger the relevant command.
- Confirm alerts are emitted to Hermes and mirrored to `#ai-hq`.

## 8. Lane discipline

- Send a command with `lane: "land"`.
- Confirm `OUT_OF_LANE_SCOPE`.
- Confirm the script performs no PropStream interaction.

## 9. Kill switch

- Send `HALT/all`.
- Confirm cost-bearing commands are refused within 5 seconds.
- Reload the page and confirm the halt persists.
- Send `RESUME/all` and confirm normal behavior resumes.

## 10. Session expiry

- Expire the PropStream session manually.
- Trigger any command.
- Confirm `SESSION_EXPIRED` and an operator notification.

## 11. First live dry run

- Run 5 ZIP searches.
- Save roughly 50 leads total.
- Skip trace a small sample.
- Monitor a small sample.
- Stop immediately on any `CAPTCHA_REQUIRED`, repeated `DOM_SELECTOR_MISSING`, or quota drift alert.
