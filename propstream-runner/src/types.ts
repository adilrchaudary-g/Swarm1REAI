export const LANE = "houses";
export const ENVELOPE_VERSION = "1.0";
export const RUNTIME_NAME = "playwright-runner";

export type CommandType =
  | "SEARCH"
  | "SAVE"
  | "EXPORT"
  | "SKIP_TRACE"
  | "HARVEST"
  | "QUOTA_CHECK"
  | "HALT"
  | "RESUME"
  | "PING";

export type EnvelopeType = "command" | "result" | "error" | "heartbeat";

export type SearchPayload = {
  command_type: "SEARCH";
  zip: string;
  filters?: Record<string, unknown>;
  max_results?: number;
};

export type SavePayload = {
  command_type: "SAVE";
  property_ids: string[];
  list_name: string;
};

export type ExportPayload = {
  command_type: "EXPORT";
  list_name: string;
};

export type SkipTracePayload = {
  command_type: "SKIP_TRACE";
  property_ids: string[];
  list_name: string;
  prefer_batch_route?: boolean;
};

export type QuotaCheckPayload = {
  command_type: "QUOTA_CHECK";
};

export type HaltPayload = {
  command_type: "HALT";
  scope?: string;
};

export type ResumePayload = {
  command_type: "RESUME";
  scope?: string;
};

export type HarvestPayload = {
  command_type: "HARVEST";
  zip: string;
  list_name: string;
  max_results?: number;
  max_skip_traces?: number;
  filters?: Record<string, unknown>;
};

export type PingPayload = {
  command_type: "PING";
};

export type CommandPayload =
  | SearchPayload
  | SavePayload
  | ExportPayload
  | SkipTracePayload
  | HarvestPayload
  | QuotaCheckPayload
  | HaltPayload
  | ResumePayload
  | PingPayload;

export type RuntimeMetadata = {
  runtime?: "playwright-runner";
  execution_mode?: "headless" | "headed";
  recovery_used?: boolean;
  fallback_recommended?: boolean;
  auth_status?: "ok" | "reauth_required" | "captcha_required";
};

export type QuotaSnapshot = {
  saves_used: number;
  saves_cap: number;
  exports_used: number;
  exports_cap: number;
  skip_traces_used: number;
  skip_traces_cap: number;
  monitored_used: number;
  monitored_cap: number;
};

export type ResultError = {
  code: string;
  message: string;
  item_ref?: string | null;
};

export type ResultPayload = RuntimeMetadata & {
  command_type: CommandType | "HEARTBEAT";
  status: "success" | "partial" | "failure";
  items: Array<Record<string, unknown>>;
  errors: ResultError[];
  quota_snapshot: QuotaSnapshot;
};

export type HeartbeatPayload = RuntimeMetadata & {
  command_type: "PING";
  status: "success" | "partial" | "failure";
  items: Array<Record<string, unknown>>;
  errors: ResultError[];
  quota_snapshot: QuotaSnapshot;
};

export type Envelope<TPayload extends object = CommandPayload | ResultPayload | HeartbeatPayload> = {
  envelope_version: string;
  message_id: string;
  timestamp: string;
  source: "swarm" | "userscript" | "playwright-runner";
  lane: "houses";
  type: EnvelopeType;
  correlation_id: string | null;
  payload: TPayload;
};

export type ScopeName = "all" | "saves" | "exports" | "skip_trace" | "monitor";

export type CounterState = {
  saves: number;
  exports: number;
  skip_trace: number;
  monitor: number;
  remoteRemaining: Partial<Record<Exclude<ScopeName, "all">, number>>;
  reconciledAt: string | null;
  operationsSinceQuotaCheck: number;
};
