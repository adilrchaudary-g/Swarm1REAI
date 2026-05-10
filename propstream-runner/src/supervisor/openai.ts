import type { RunnerConfig } from "../config.js";
import type { SupervisorClient } from "./client.js";
import { buildSupervisorDeveloperPrompt, buildSupervisorSystemPrompt, buildSupervisorUserPrompt } from "./prompt.js";
import { SupervisorDecisionSchema, type SupervisorDecision, type SupervisorInput } from "./schema.js";

const DECISION_SCHEMA = {
  name: "supervisor_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      diagnosis: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      next_action: {
        type: "string",
        enum: [
          "refresh_current_page",
          "reopen_search_page",
          "reopen_filters_panel",
          "retry_alternate_selector_family",
          "reopen_property_detail_panel",
          "reopen_saved_list_page",
          "wait_for_route_stabilization",
          "capture_trace_and_escalate",
          "switch_to_fallback_userscript",
        ],
      },
      reason: { type: "string" },
      stop_and_escalate: { type: "boolean" },
    },
    required: ["diagnosis", "confidence", "next_action", "reason", "stop_and_escalate"],
  },
};

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const parts: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export class OpenAISupervisorClient implements SupervisorClient {
  constructor(private readonly config: RunnerConfig) {}

  async decide(input: SupervisorInput): Promise<SupervisorDecision> {
    if (!this.config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModel,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: buildSupervisorSystemPrompt() }],
          },
          {
            role: "developer",
            content: [{ type: "input_text", text: buildSupervisorDeveloperPrompt() }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: buildSupervisorUserPrompt(input) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: DECISION_SCHEMA.name,
            schema: DECISION_SCHEMA.schema,
            strict: true,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI supervisor failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    const text = extractOutputText(payload);
    return SupervisorDecisionSchema.parse(JSON.parse(text));
  }
}
