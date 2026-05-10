import type { SupervisorInput } from "./schema.js";

export function buildSupervisorSystemPrompt(): string {
  return [
    "You are a constrained recovery planner for PropStream browser automation.",
    "Your job is to choose one safe approved recovery action when deterministic automation diverges.",
    "Do not browse freely, invent actions, or expose PII.",
    "Never recommend repeated quota-bearing operations unless the action list explicitly permits a safe retry path.",
    "If the state is ambiguous, choose escalation instead of guessing.",
    "Return JSON only.",
  ].join(" ");
}

export function buildSupervisorDeveloperPrompt(): string {
  return [
    "Approved actions are exhaustive.",
    "Use only the provided structured page state.",
    "Success means restoring the deterministic runner to a known page state without extra risk.",
    "If captcha or auth loss is present, prefer escalation or fallback.",
    "Maximum intended recovery depth is two attempts.",
    "Do not ask for tools, extra browsing, raw HTML, or screenshots.",
  ].join(" ");
}

export function buildSupervisorUserPrompt(input: SupervisorInput): string {
  return JSON.stringify(
    {
      objective: input.objective,
      current_command: input.current_command,
      current_route: input.current_route,
      current_page_phase: input.current_page_phase,
      last_successful_step: input.last_successful_step,
      contradictions: input.contradictions,
      available_actions: input.available_actions,
      page_state: input.page_state,
      hard_prohibitions: [
        "No PII exposure",
        "No unapproved clicks or navigation",
        "No quota-bearing retries without safe confirmation",
      ],
    },
    null,
    2,
  );
}
