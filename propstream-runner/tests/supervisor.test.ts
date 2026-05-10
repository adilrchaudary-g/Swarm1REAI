import { describe, expect, it } from "vitest";
import { BoundedSupervisor, RuleBasedSupervisorClient } from "../src/supervisor/engine.js";

describe("supervisor", () => {
  it("escalates on captcha", async () => {
    const supervisor = new BoundedSupervisor(new RuleBasedSupervisorClient());
    const decision = await supervisor.decide({
      objective: "Recover search flow",
      current_command: { command_type: "SEARCH", zip: "77084" },
      current_route: "/search",
      current_page_phase: "results",
      last_successful_step: "opened search",
      contradictions: [],
      available_actions: [
        "refresh_current_page",
        "switch_to_fallback_userscript",
        "capture_trace_and_escalate",
      ],
      page_state: {
        route: "/search",
        title: "PropStream",
        page_phase: "results",
        visible_regions: [],
        candidate_actions: [],
        result_count_text: null,
        visible_row_count: 0,
        selected_list_name: null,
        selected_zip: "77084",
        has_captcha: true,
        auth_required: false,
        diagnostics: {},
      },
    });

    expect(decision.stop_and_escalate).toBe(true);
    expect(decision.next_action).toBe("switch_to_fallback_userscript");
  });
});
