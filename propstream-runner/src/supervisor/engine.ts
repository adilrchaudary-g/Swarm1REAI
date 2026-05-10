import type { SupervisorClient } from "./client.js";
import {
  ApprovedActionSchema,
  SupervisorDecisionSchema,
  type SupervisorDecision,
  type SupervisorInput,
} from "./schema.js";

export class RuleBasedSupervisorClient implements SupervisorClient {
  async decide(input: SupervisorInput): Promise<SupervisorDecision> {
    if (input.page_state.has_captcha) {
      return SupervisorDecisionSchema.parse({
        diagnosis: "Captcha detected in page state.",
        confidence: 0.98,
        next_action: "switch_to_fallback_userscript",
        reason: "Captcha requires human-authenticated recovery and should fall back immediately.",
        stop_and_escalate: true,
      });
    }

    if (input.page_state.auth_required) {
      return SupervisorDecisionSchema.parse({
        diagnosis: "Authentication is required again.",
        confidence: 0.95,
        next_action: "capture_trace_and_escalate",
        reason: "The browser session is no longer authenticated; preserve artifacts and escalate.",
        stop_and_escalate: true,
      });
    }

    if (input.contradictions.some((item) => /filter/i.test(item))) {
      return SupervisorDecisionSchema.parse({
        diagnosis: "The filters panel likely failed to open or was lost on rerender.",
        confidence: 0.77,
        next_action: "reopen_filters_panel",
        reason: "The failure pattern points to the filter overlay being unavailable.",
        stop_and_escalate: false,
      });
    }

    if (input.contradictions.some((item) => /selector/i.test(item))) {
      return SupervisorDecisionSchema.parse({
        diagnosis: "Primary selectors appear stale or the DOM structure shifted.",
        confidence: 0.72,
        next_action: "retry_alternate_selector_family",
        reason: "Use the approved selector fallback family before escalating.",
        stop_and_escalate: false,
      });
    }

    if (!input.page_state.route.includes("/search")) {
      return SupervisorDecisionSchema.parse({
        diagnosis: "The browser is no longer on the expected search workflow route.",
        confidence: 0.74,
        next_action: "reopen_search_page",
        reason: "Restoring the search route is the safest deterministic recovery.",
        stop_and_escalate: false,
      });
    }

    return SupervisorDecisionSchema.parse({
      diagnosis: "The page diverged in a way that is not safely classifiable.",
      confidence: 0.55,
      next_action: "capture_trace_and_escalate",
      reason: "The state is ambiguous and should not be recovered through speculative actions.",
      stop_and_escalate: true,
    });
  }
}

export class BoundedSupervisor {
  constructor(private readonly client: SupervisorClient) {}

  async decide(input: SupervisorInput): Promise<SupervisorDecision> {
    const decision = await this.client.decide(input);
    const parsed = SupervisorDecisionSchema.parse(decision);
    ApprovedActionSchema.parse(parsed.next_action);
    return parsed;
  }
}
