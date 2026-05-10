import { buildQuotaSnapshot, normalizeScope, nowIso } from "./protocol.js";
import type { CounterState, QuotaSnapshot, ScopeName } from "./types.js";

const SOFT_CAPS = {
  saves: 42_000,
  exports: 40_000,
  skip_trace: 40_000,
  monitor: 45_000,
} as const;

const QUOTA_THRESHOLDS = [70, 85, 95] as const;
const QUOTA_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export class BridgeError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type QuotaAlert = {
  scope: Exclude<ScopeName, "all">;
  threshold: number;
  used: number;
  cap: number;
  percent: number;
};

export class QuotaManager {
  readonly counters: CounterState;
  readonly thresholdState: Record<string, number[]>;
  readonly haltedScopes: Set<string>;
  masterHalt: boolean;

  constructor(input?: Partial<CounterState> & {
    thresholdState?: Record<string, number[]>;
    haltedScopes?: string[];
    masterHalt?: boolean;
  }) {
    this.counters = {
      saves: input?.saves ?? 0,
      exports: input?.exports ?? 0,
      skip_trace: input?.skip_trace ?? 0,
      monitor: input?.monitor ?? 0,
      remoteRemaining: input?.remoteRemaining ?? {},
      reconciledAt: input?.reconciledAt ?? null,
      operationsSinceQuotaCheck: input?.operationsSinceQuotaCheck ?? 0,
    };
    this.thresholdState = input?.thresholdState ?? {};
    this.haltedScopes = new Set(input?.haltedScopes ?? []);
    this.masterHalt = input?.masterHalt ?? false;
  }

  snapshot(): QuotaSnapshot {
    return buildQuotaSnapshot(this.counters);
  }

  serialize() {
    return {
      counters: this.counters,
      thresholdState: this.thresholdState,
      haltedScopes: Array.from(this.haltedScopes),
      masterHalt: this.masterHalt,
    };
  }

  isScopeHalted(scope: string) {
    return this.masterHalt || this.haltedScopes.has(normalizeScope(scope));
  }

  haltScope(scope: string) {
    const normalized = normalizeScope(scope);
    if (normalized === "all") {
      this.masterHalt = true;
      return;
    }
    this.haltedScopes.add(normalized);
  }

  resumeScope(scope: string) {
    const normalized = normalizeScope(scope);
    if (normalized === "all") {
      this.masterHalt = false;
      this.haltedScopes.clear();
      return;
    }
    this.haltedScopes.delete(normalized);
  }

  guardCostBearingCommand(scope: Exclude<ScopeName, "all">, commandCost = 1) {
    if (this.masterHalt || this.isScopeHalted(scope)) {
      throw new BridgeError("BRIDGE_HALTED", `Bridge halted for scope ${scope}`);
    }
    const localUsed = this.counters[scope];
    const localCap = SOFT_CAPS[scope];
    if (localUsed + commandCost > localCap) {
      throw new BridgeError(
        "QUOTA_LOCAL_HALT",
        `Local soft cap would be exceeded for ${scope}`,
      );
    }
    const reconciledAt = this.counters.reconciledAt
      ? new Date(this.counters.reconciledAt).getTime()
      : 0;
    const quotaCacheFresh = reconciledAt && Date.now() - reconciledAt <= QUOTA_CACHE_MAX_AGE_MS;
    const remaining = this.counters.remoteRemaining[scope];
    const quotaCacheUsable =
      typeof remaining === "number" &&
      quotaCacheFresh &&
      this.counters.operationsSinceQuotaCheck < 50;
    if (!quotaCacheUsable) {
      throw new BridgeError(
        "QUOTA_CHECK_REQUIRED",
        `Run QUOTA_CHECK before executing ${scope}`,
      );
    }
    if ((remaining ?? 0) < commandCost) {
      throw new BridgeError(
        "QUOTA_REMOTE_EXHAUSTED",
        `PropStream reports no remaining capacity for ${scope}`,
      );
    }
  }

  increment(scope: Exclude<ScopeName, "all">, amount = 1) {
    this.counters[scope] += amount;
    this.counters.operationsSinceQuotaCheck += amount;
    if (typeof this.counters.remoteRemaining[scope] === "number") {
      this.counters.remoteRemaining[scope] = Math.max(
        0,
        (this.counters.remoteRemaining[scope] ?? 0) - amount,
      );
    }
    return this.collectThresholdAlerts(scope);
  }

  reconcile(remoteRemaining: Partial<Record<Exclude<ScopeName, "all">, number>>) {
    this.counters.remoteRemaining = remoteRemaining;
    this.counters.reconciledAt = nowIso();
    this.counters.operationsSinceQuotaCheck = 0;

    (Object.keys(SOFT_CAPS) as Array<Exclude<ScopeName, "all">>).forEach((key) => {
      const remaining = remoteRemaining[key];
      if (typeof remaining === "number") {
        this.counters[key] = Math.max(0, SOFT_CAPS[key] - remaining);
      }
    });

    return this.snapshot();
  }

  private collectThresholdAlerts(scope: Exclude<ScopeName, "all">): QuotaAlert[] {
    const used = this.counters[scope];
    const cap = SOFT_CAPS[scope];
    const percent = Math.floor((used / cap) * 100);
    const seen = this.thresholdState[scope] ?? [];
    const alerts: QuotaAlert[] = [];

    for (const threshold of QUOTA_THRESHOLDS) {
      if (percent >= threshold && !seen.includes(threshold)) {
        seen.push(threshold);
        alerts.push({ scope, threshold, used, cap, percent });
      }
    }

    this.thresholdState[scope] = seen;
    return alerts;
  }
}
