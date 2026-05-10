import { z } from "zod";

export const ApprovedActionSchema = z.enum([
  "refresh_current_page",
  "reopen_search_page",
  "reopen_filters_panel",
  "retry_alternate_selector_family",
  "reopen_property_detail_panel",
  "reopen_saved_list_page",
  "wait_for_route_stabilization",
  "capture_trace_and_escalate",
  "switch_to_fallback_userscript",
]);

export const PageStateSchema = z.object({
  route: z.string(),
  title: z.string(),
  page_phase: z.string(),
  visible_regions: z.array(z.string()),
  candidate_actions: z.array(z.string()),
  result_count_text: z.string().nullable(),
  visible_row_count: z.number().int().nonnegative(),
  selected_list_name: z.string().nullable(),
  selected_zip: z.string().nullable(),
  has_captcha: z.boolean(),
  auth_required: z.boolean(),
  diagnostics: z.record(z.string(), z.unknown()),
});

export type PageState = z.infer<typeof PageStateSchema>;

export const SupervisorInputSchema = z.object({
  objective: z.string(),
  current_command: z.record(z.string(), z.unknown()),
  current_route: z.string(),
  current_page_phase: z.string(),
  last_successful_step: z.string(),
  contradictions: z.array(z.string()),
  available_actions: z.array(ApprovedActionSchema),
  page_state: PageStateSchema,
});

export type SupervisorInput = z.infer<typeof SupervisorInputSchema>;

export const SupervisorDecisionSchema = z.object({
  diagnosis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  next_action: ApprovedActionSchema,
  reason: z.string().min(1),
  stop_and_escalate: z.boolean(),
});

export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;
