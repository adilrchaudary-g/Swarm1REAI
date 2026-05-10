# Selectors

Because PropStream is a third-party app and I could not attach to a live account from this environment, the userscript uses selector groups and text heuristics rather than pretending to know the final production DOM. This file is the operator-maintained map to tighten once the live DOM is inspected.

## Strategy

- Prefer `data-*`, `aria-*`, and semantic-role selectors first.
- Use text-based fallbacks second.
- Use broad class-name patterns last.
- On `DOM_SELECTOR_MISSING`, halt the relevant operation, mirror a sanitized DOM structure snapshot to `#ai-hq`, and update the selector group here before resuming.

## Selector groups in the script

### Session / captcha detection

- `SELECTORS.sessionExpiredIndicators`
- `SELECTORS.captchaIndicators`

### Search flow

- `SELECTORS.searchPageLinks`
- `SELECTORS.searchZipInputs`
- `SELECTORS.filterButtons`
- `SELECTORS.applyButtons`
- `SELECTORS.resultRows`
- `SELECTORS.resultCountLabels`
- `SELECTORS.paginationNextButtons`

### Per-property actions

- `SELECTORS.saveButtons`
- `SELECTORS.listPickerInputs`
- `SELECTORS.listPickerOptions`
- `SELECTORS.skipTraceButtons`
- `SELECTORS.monitorButtons`
- `SELECTORS.detailLinks`

### Export / usage

- `SELECTORS.exportButtons`
- `SELECTORS.usageLinks`

## Live validation checklist

When you inspect PropStream, verify:

1. The search page can be reached with `searchPageLinks`, or set a stable direct URL strategy.
2. ZIP input selection works without opening a separate location modal first.
3. Results rows expose a stable per-row ID or property-detail link.
4. Save and monitor buttons expose a post-click success state the script can trust.
5. Skip-trace results appear in a modal, side panel, or detail page region that can be isolated without scraping unrelated PII from the rest of the page.
6. Export flow exposes a download link or predictable DOM event after the export click.
7. Usage page exposes text for saves, exports, skip traces, and monitored counts in a parseable format.

## Recommended next refinement

After first live operator test, replace the broad fallback selectors with exact selectors for:

- search ZIP input
- apply-filters button
- result table row
- save button
- skip-trace button
- export button
- usage counters
