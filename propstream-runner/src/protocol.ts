import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ENVELOPE_VERSION,
  LANE,
  type CommandPayload,
  type CommandType,
  type Envelope,
  type EnvelopeType,
  type HeartbeatPayload,
  type QuotaSnapshot,
  type ResultPayload,
  type RuntimeMetadata,
} from "./types.js";

const SearchPayloadSchema = z.object({
  command_type: z.literal("SEARCH"),
  zip: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional(),
  max_results: z.number().int().positive().max(500).optional(),
});

const SavePayloadSchema = z.object({
  command_type: z.literal("SAVE"),
  property_ids: z.array(z.string().min(1)).min(1),
  list_name: z.string().min(1),
});

const ExportPayloadSchema = z.object({
  command_type: z.literal("EXPORT"),
  list_name: z.string().min(1),
});

const SkipTracePayloadSchema = z.object({
  command_type: z.literal("SKIP_TRACE"),
  property_ids: z.array(z.string().min(1)).min(1),
  list_name: z.string().min(1),
  prefer_batch_route: z.boolean().optional(),
});

const QuotaPayloadSchema = z.object({
  command_type: z.literal("QUOTA_CHECK"),
});

const HaltPayloadSchema = z.object({
  command_type: z.literal("HALT"),
  scope: z.string().optional(),
});

const ResumePayloadSchema = z.object({
  command_type: z.literal("RESUME"),
  scope: z.string().optional(),
});

const HarvestPayloadSchema = z.object({
  command_type: z.literal("HARVEST"),
  zip: z.string().min(1),
  list_name: z.string().min(1),
  max_results: z.number().int().positive().max(500).optional(),
  max_skip_traces: z.number().int().positive().max(500).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

const PingPayloadSchema = z.object({
  command_type: z.literal("PING"),
});

export const CommandPayloadSchema = z.discriminatedUnion("command_type", [
  SearchPayloadSchema,
  SavePayloadSchema,
  ExportPayloadSchema,
  SkipTracePayloadSchema,
  HarvestPayloadSchema,
  QuotaPayloadSchema,
  HaltPayloadSchema,
  ResumePayloadSchema,
  PingPayloadSchema,
]);

const BaseEnvelopeSchema = z.object({
  envelope_version: z.literal(ENVELOPE_VERSION),
  message_id: z.string().min(1),
  timestamp: z.string().datetime(),
  source: z.enum(["swarm", "userscript", "playwright-runner"]),
  lane: z.literal(LANE),
  type: z.enum(["command", "result", "error", "heartbeat"]),
  correlation_id: z.string().nullable(),
});

export const CommandEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal("command"),
  payload: CommandPayloadSchema,
});

export function nowIso(): string {
  return new Date().toISOString();
}

export function createMessageId(): string {
  return randomUUID();
}

export function normalizeScope(scope: string | null | undefined) {
  if (scope === "all") return "all" as const;
  if (scope === "saves") return "saves" as const;
  if (scope === "exports") return "exports" as const;
  if (scope === "monitor" || scope === "monitored") return "monitor" as const;
  if (scope === "skip_trace" || scope === "skip-trace" || scope === "skip traces") {
    return "skip_trace" as const;
  }
  return String(scope || "").toLowerCase();
}

export function validateCommandEnvelope(input: unknown): Envelope<CommandPayload> {
  return CommandEnvelopeSchema.parse(input) as Envelope<CommandPayload>;
}

export function buildQuotaSnapshot(counters: {
  saves: number;
  exports: number;
  skip_trace: number;
  monitor: number;
}): QuotaSnapshot {
  return {
    saves_used: counters.saves,
    saves_cap: 42_000,
    exports_used: counters.exports,
    exports_cap: 40_000,
    skip_traces_used: counters.skip_trace,
    skip_traces_cap: 40_000,
    monitored_used: counters.monitor,
    monitored_cap: 45_000,
  };
}

export function buildEnvelope<TPayload extends object>(
  type: EnvelopeType,
  payload: TPayload,
  options?: {
    source?: Envelope<TPayload>["source"];
    correlationId?: string | null;
    messageId?: string;
  },
): Envelope<TPayload> {
  return {
    envelope_version: ENVELOPE_VERSION,
    message_id: options?.messageId ?? createMessageId(),
    timestamp: nowIso(),
    source: options?.source ?? "playwright-runner",
    lane: LANE,
    type,
    correlation_id: options?.correlationId ?? null,
    payload,
  };
}

export function buildResultPayload(
  commandType: CommandType | "HEARTBEAT",
  quotaSnapshot: QuotaSnapshot,
  items: Array<Record<string, unknown>> = [],
  errors: ResultPayload["errors"] = [],
  metadata: RuntimeMetadata = {},
  status?: ResultPayload["status"],
): ResultPayload | HeartbeatPayload {
  const computedStatus =
    status ?? (errors.length ? (items.length ? "partial" : "failure") : "success");

  return {
    command_type: commandType === "HEARTBEAT" ? "PING" : commandType,
    status: computedStatus,
    items,
    errors,
    quota_snapshot: quotaSnapshot,
    runtime: metadata.runtime,
    execution_mode: metadata.execution_mode,
    recovery_used: metadata.recovery_used,
    fallback_recommended: metadata.fallback_recommended,
    auth_status: metadata.auth_status,
  };
}
