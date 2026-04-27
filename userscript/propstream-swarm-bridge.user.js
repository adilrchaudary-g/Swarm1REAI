// ==UserScript==
// @name         PropStream x Swarm Bridge (Houses lane)
// @namespace    swarm.wholesaling.houses
// @version      0.2.0
// @description  Bridges Hermes commands to the PropStream web app for the Houses lane
// @match        https://app.propstream.com/*
// @match        https://*.propstream.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "0.2.0";
  const ENVELOPE_VERSION = "1.0";
  const LANE = "houses";
  const IDLE_HEARTBEAT_MS = 60_000;
  const DISCORD_HEARTBEAT_MS = 10 * 60_000;
  const MAX_LOG_ENTRIES = 1000;
  const MAX_IN_MEMORY_SKIP_TRACE_CACHE = 250;
  const DEFAULT_POLL_INTERVAL_MS = 10_000;
  const DEFAULT_LONG_POLL_TIMEOUT_MS = 30_000;
  const DOM_WAIT_TIMEOUT_MS = 10_000;
  const DOM_POLL_INTERVAL_MS = 250;
  const QUOTA_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const OPERATOR_HOURS = { start: 8, end: 23 };
  const SOFT_CAPS = {
    saves: 42_000,
    exports: 40_000,
    skip_trace: 40_000,
    monitor: 45_000,
  };
  const QUOTA_THRESHOLDS = [70, 85, 95];
  const BLOCKED_STATES = new Set(["SC", "IL", "OK", "KY", "PA", "VA"]);
  const STORAGE_KEYS = {
    config: "pssb_config_v1",
    masterHalt: "pssb_master_halt_v1",
    haltedScopes: "pssb_halted_scopes_v1",
    lastCommandId: "pssb_last_command_id_v1",
    counters: "pssb_counters_v1",
    thresholdState: "pssb_threshold_state_v1",
    rollingLog: "pssb_rolling_log_v1",
    processedCommands: "pssb_processed_commands_v1",
    skipTraceMeta: "pssb_skip_trace_meta_v1",
    lastDiscordHeartbeatAt: "pssb_last_discord_heartbeat_v1",
    lastSuccessfulCommandAt: "pssb_last_successful_command_at_v1",
  };

  const DEFAULT_CONFIG = {
    hermesPollUrl: "",
    hermesEventUrl: "",
    hermesHeartbeatUrl: "",
    hermesMethod: "GET",
    hermesResultMethod: "POST",
    authType: "bearer",
    authHeaderName: "Authorization",
    authToken: "",
    authPrefix: "Bearer ",
    pollMode: "long",
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    longPollTimeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    enableOperatorHours: true,
    operatorHoursStart: OPERATOR_HOURS.start,
    operatorHoursEnd: OPERATOR_HOURS.end,
    discordCommandsWebhook: "",
    discordResultsWebhook: "",
    discordQuotaWebhook: "",
    discordAlfredWebhook: "",
    propstreamUsageUrl: "",
    selectorsDebug: false,
    randomDelayMinMs: 1500,
    randomDelayMaxMs: 4500,
  };

  const SELECTORS = {
    sessionExpiredIndicators: [
      '[data-testid*="login"]',
      'form[action*="login"]',
      'input[type="password"]',
      "a[href*='login']",
    ],
    captchaIndicators: [
      'iframe[src*="recaptcha"]',
      '[class*="captcha"]',
      '[id*="captcha"]',
      '[data-sitekey]',
    ],
    searchPageLinks: [
      'a[href*="search"]',
      'button[data-testid*="search"]',
      'button[aria-label*="Search"]',
    ],
    searchZipInputs: [
      'input[placeholder*="ZIP" i]',
      'input[placeholder*="Zip" i]',
      'input[name*="zip" i]',
      'input[aria-label*="ZIP" i]',
      'input[aria-label*="location" i]',
    ],
    filterButtons: [
      'button[data-testid*="filter"]',
      'button[aria-label*="filter" i]',
      'button[class*="filter"]',
    ],
    applyButtons: [
      'button[data-testid*="apply"]',
      'button[aria-label*="apply" i]',
      'button[class*="apply"]',
      'button[type="submit"]',
    ],
    resultRows: [
      'table tbody tr',
      '[role="rowgroup"] [role="row"]',
      '[data-testid*="property-row"]',
      '[class*="property-row"]',
      '[class*="result-row"]',
    ],
    resultCountLabels: [
      '[data-testid*="result-count"]',
      '[class*="result-count"]',
      "h1",
      "h2",
      '[class*="header"]',
    ],
    paginationNextButtons: [
      'button[aria-label*="next" i]',
      'a[aria-label*="next" i]',
      'button[data-testid*="next"]',
    ],
    saveButtons: [
      'button[data-testid*="save"]',
      'button[aria-label*="save" i]',
      'button[class*="save"]',
    ],
    listPickerInputs: [
      'input[placeholder*="list" i]',
      'input[aria-label*="list" i]',
      '[role="dialog"] input',
    ],
    listPickerOptions: ['[role="option"]', "[role='dialog'] li", "ul li"],
    exportButtons: [
      'button[data-testid*="export"]',
      'button[aria-label*="export" i]',
      'button[class*="export"]',
      'a[href*="export"]',
    ],
    exportReadyIndicators: [
      '[role="status"]',
      '[aria-live]',
      '[data-testid*="toast"]',
      '[class*="toast"]',
      '[class*="notification"]',
    ],
    exportDownloadLinks: [
      'a[download]',
      'a[href*=".csv"]',
      'a[href*=".xlsx"]',
      'a[href*="download"]',
    ],
    skipTraceButtons: [
      'button[data-testid*="skip"]',
      'button[aria-label*="skip" i]',
      'button[class*="skip"]',
      'a[href*="skip"]',
    ],
    skipTraceContainers: [
      '[role="dialog"]',
      '[aria-modal="true"]',
      'aside',
      '[data-testid*="skip"]',
      '[data-testid*="contact"]',
      '[class*="skip"]',
      '[class*="trace"]',
      '[class*="contact"]',
      '[class*="owner"]',
    ],
    skipTracePhoneNodes: [
      'a[href^="tel:"]',
      '[data-testid*="phone"]',
      '[class*="phone"]',
    ],
    skipTraceEmailNodes: [
      'a[href^="mailto:"]',
      '[data-testid*="email"]',
      '[class*="email"]',
    ],
    detailLinks: [
      'a[href*="/property/"]',
      'a[href*="/details"]',
      'a[data-testid*="property-link"]',
    ],
    usageLinks: [
      'a[href*="account"]',
      'a[href*="billing"]',
      'a[href*="usage"]',
      'button[aria-label*="account" i]',
    ],
    usageCounterRegions: [
      '[data-testid*="usage"]',
      '[data-testid*="quota"]',
      '[class*="usage"]',
      '[class*="quota"]',
      '[class*="billing"]',
      'main',
    ],
  };

  const runtime = {
    startedAt: Date.now(),
    queueDepth: 0,
    lastSuccessfulCommandAt: GM_getValue(STORAGE_KEYS.lastSuccessfulCommandAt, null),
    inFlightCommandId: null,
    inMemorySkipTraceCache: new Map(),
    panelMounted: false,
    pollTimer: null,
    heartbeatTimer: null,
    discordHeartbeatTimer: null,
  };

  const state = {
    config: loadConfig(),
    masterHalt: Boolean(GM_getValue(STORAGE_KEYS.masterHalt, false)),
    haltedScopes: new Set(GM_getValue(STORAGE_KEYS.haltedScopes, [])),
    lastCommandId: GM_getValue(STORAGE_KEYS.lastCommandId, null),
    counters: GM_getValue(STORAGE_KEYS.counters, buildEmptyCounters()),
    thresholdState: GM_getValue(STORAGE_KEYS.thresholdState, {}),
    processedCommands: GM_getValue(STORAGE_KEYS.processedCommands, []),
    skipTraceMeta: GM_getValue(STORAGE_KEYS.skipTraceMeta, {}),
    lastDiscordHeartbeatAt: GM_getValue(
      STORAGE_KEYS.lastDiscordHeartbeatAt,
      0,
    ),
  };

  function loadConfig() {
    const saved = GM_getValue(STORAGE_KEYS.config, {});
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      // Backward-compat: migrate the old operator alert webhook key if present.
      discordAlfredWebhook:
        saved.discordAlfredWebhook || saved.discordAiHqWebhook || "",
      discordQuotaWebhook: saved.discordQuotaWebhook || "",
    };
  }

  function buildEmptyCounters() {
    return {
      saves: 0,
      exports: 0,
      skip_trace: 0,
      monitor: 0,
      operationsSinceQuotaCheck: 0,
      remoteRemaining: null,
      reconciledAt: null,
      billingCycleMonth: new Date().getUTCMonth() + 1,
      billingCycleDay: 22,
    };
  }

  function persistState() {
    GM_setValue(STORAGE_KEYS.config, state.config);
    GM_setValue(STORAGE_KEYS.masterHalt, state.masterHalt);
    GM_setValue(STORAGE_KEYS.haltedScopes, Array.from(state.haltedScopes));
    GM_setValue(STORAGE_KEYS.lastCommandId, state.lastCommandId);
    GM_setValue(STORAGE_KEYS.counters, state.counters);
    GM_setValue(STORAGE_KEYS.thresholdState, state.thresholdState);
    GM_setValue(STORAGE_KEYS.processedCommands, state.processedCommands.slice(-1000));
    GM_setValue(STORAGE_KEYS.skipTraceMeta, state.skipTraceMeta);
    GM_setValue(STORAGE_KEYS.lastDiscordHeartbeatAt, state.lastDiscordHeartbeatAt);
    GM_setValue(STORAGE_KEYS.lastSuccessfulCommandAt, runtime.lastSuccessfulCommandAt);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createMessageId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function redactForLog(value) {
    const clone = safeJsonParse(JSON.stringify(value), value);
    return deepRedact(clone);
  }

  function deepRedact(input) {
    if (Array.isArray(input)) {
      return input.map(deepRedact);
    }
    if (!input || typeof input !== "object") {
      if (typeof input === "string") {
        return input
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
          .replace(/\+?1?\s?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[redacted-phone]");
      }
      return input;
    }
    const next = {};
    Object.entries(input).forEach(([key, value]) => {
      if (
        key === "phone_numbers" ||
        key === "email_addresses" ||
        key === "possible_relatives" ||
        key === "contacts" ||
        key === "pii" ||
        key === "mailing_address" ||
        key === "owner_name" ||
        key === "owner_id"
      ) {
        next[key] = "[redacted]";
      } else {
        next[key] = deepRedact(value);
      }
    });
    return next;
  }

  function addLog(level, event, details = {}) {
    const current = GM_getValue(STORAGE_KEYS.rollingLog, []);
    current.push({
      at: nowIso(),
      level,
      event,
      details: redactForLog(details),
    });
    GM_setValue(STORAGE_KEYS.rollingLog, current.slice(-MAX_LOG_ENTRIES));
    renderLogs();
  }

  function getLogs() {
    return GM_getValue(STORAGE_KEYS.rollingLog, []);
  }

  function notify(title, text) {
    try {
      GM_notification({ title, text, timeout: 7000 });
    } catch {
      // no-op
    }
  }

  function isWithinOperatorWindow() {
    if (!state.config.enableOperatorHours) return true;
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: state.config.timezone,
    });
    const hour = Number(formatter.format(new Date()));
    return hour >= Number(state.config.operatorHoursStart) &&
      hour < Number(state.config.operatorHoursEnd);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomizedDelay() {
    const min = Number(state.config.randomDelayMinMs) || 1500;
    const max = Number(state.config.randomDelayMaxMs) || 4500;
    const ms = min + Math.floor(Math.random() * Math.max(1, max - min));
    return delay(ms);
  }

  function buildAuthHeaders() {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (!state.config.authToken) return headers;
    if (state.config.authType === "bearer") {
      headers[state.config.authHeaderName || "Authorization"] =
        `${state.config.authPrefix || "Bearer "}${state.config.authToken}`;
    } else if (state.config.authType === "custom_header") {
      headers[state.config.authHeaderName || "X-Hermes-Token"] =
        state.config.authToken;
    }
    return headers;
  }

  function gmRequest({ method, url, headers = {}, data, timeout = 30_000 }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        timeout,
        onload: (response) => {
          resolve(response);
        },
        onerror: (error) => {
          reject(error);
        },
        ontimeout: () => {
          reject(new Error(`Timed out after ${timeout}ms`));
        },
      });
    });
  }

  const Hermes = {
    async poll() {
      if (!state.config.hermesPollUrl) {
        throw new Error("Hermes poll URL not configured");
      }
      const url = new URL(state.config.hermesPollUrl);
      url.searchParams.set("lane", LANE);
      if (state.lastCommandId) {
        url.searchParams.set("after", state.lastCommandId);
      }
      if (state.config.pollMode === "long") {
        url.searchParams.set("wait_ms", String(state.config.longPollTimeoutMs));
      }
      const response = await gmRequest({
        method: state.config.hermesMethod || "GET",
        url: url.toString(),
        headers: buildAuthHeaders(),
        timeout:
          state.config.pollMode === "long"
            ? Number(state.config.longPollTimeoutMs) + 5_000
            : Number(state.config.pollIntervalMs) + 5_000,
      });
      if (response.status >= 400) {
        throw new Error(`Hermes poll failed with HTTP ${response.status}`);
      }
      return safeJsonParse(response.responseText, []);
    },

    async postEnvelope(envelope) {
      const target =
        envelope.type === "heartbeat" && state.config.hermesHeartbeatUrl
          ? state.config.hermesHeartbeatUrl
          : state.config.hermesEventUrl;
      if (!target) {
        throw new Error("Hermes event URL not configured");
      }
      const response = await gmRequest({
        method: state.config.hermesResultMethod || "POST",
        url: target,
        headers: buildAuthHeaders(),
        data: JSON.stringify(envelope),
        timeout: 30_000,
      });
      if (response.status >= 400) {
        throw new Error(`Hermes POST failed with HTTP ${response.status}`);
      }
      return safeJsonParse(response.responseText, {});
    },
  };

  const Discord = {
    async post(webhookUrl, content, extras = {}) {
      if (!webhookUrl) return;
      const body = {
        content,
        allowed_mentions: { parse: [] },
        ...extras,
      };
      await gmRequest({
        method: "POST",
        url: webhookUrl,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        data: JSON.stringify(body),
        timeout: 15_000,
      });
    },

    async mirrorCommand(envelope) {
      if (!state.config.discordCommandsWebhook) return;
      const payload = envelope.payload || {};
      const summary = [
        "`command`",
        `type=${payload.command_type || "unknown"}`,
        `id=${envelope.message_id}`,
        `corr=${envelope.correlation_id || "n/a"}`,
        `lane=${envelope.lane}`,
      ].join(" ");
      await this.post(
        state.config.discordCommandsWebhook,
        `${summary}\n\`\`\`json\n${truncate(
          JSON.stringify(redactForLog(envelope), null, 2),
          1800,
        )}\n\`\`\``,
      );
    },

    async mirrorResult(envelope) {
      if (!state.config.discordResultsWebhook) return;
      const payload = envelope.payload || {};
      const isSkipTrace = payload.command_type === "SKIP_TRACE";
      const safePayload = isSkipTrace ? redactSkipTraceResult(payload) : payload;
      const summary = [
        "`result`",
        `type=${payload.command_type || "unknown"}`,
        `status=${payload.status || "unknown"}`,
        `corr=${envelope.correlation_id || "n/a"}`,
      ].join(" ");
      await this.post(
        state.config.discordResultsWebhook,
        `${summary}\n\`\`\`json\n${truncate(
          JSON.stringify(redactForLog(safePayload), null, 2),
          1800,
        )}\n\`\`\``,
      );
    },

    async postAlfredAlert(content) {
      if (!state.config.discordAlfredWebhook) return;
      await this.post(state.config.discordAlfredWebhook, content);
    },

    async postQuotaAlert(content) {
      if (!state.config.discordQuotaWebhook) return;
      await this.post(state.config.discordQuotaWebhook, content);
    },

    async mirrorQuota(payload) {
      if (!state.config.discordQuotaWebhook) return;
      await this.post(
        state.config.discordQuotaWebhook,
        `\`quota\` status=${payload.status || "unknown"}\n\`\`\`json\n${truncate(
          JSON.stringify(redactForLog(payload), null, 2),
          1800,
        )}\n\`\`\``,
      );
    },
  };

  function redactSkipTraceResult(payload) {
    const items = Array.isArray(payload.items)
      ? payload.items.map((item) => ({
          property_id: item.property_id,
          contacts_returned: item.contacts_returned || countContacts(item),
          phone_count: Array.isArray(item.phone_numbers) ? item.phone_numbers.length : 0,
          email_count: Array.isArray(item.email_addresses)
            ? item.email_addresses.length
            : 0,
          status: item.status || "success",
        }))
      : [];
    return {
      ...payload,
      items,
      errors: redactForLog(payload.errors || []),
    };
  }

  function countContacts(item) {
    const phones = Array.isArray(item.phone_numbers) ? item.phone_numbers.length : 0;
    const emails = Array.isArray(item.email_addresses)
      ? item.email_addresses.length
      : 0;
    return phones + emails;
  }

  function truncate(value, length) {
    if (!value || value.length <= length) return value;
    return `${value.slice(0, length)}...`;
  }

  function buildQuotaSnapshot() {
    return {
      saves_used: state.counters.saves || 0,
      saves_cap: SOFT_CAPS.saves,
      exports_used: state.counters.exports || 0,
      exports_cap: SOFT_CAPS.exports,
      skip_traces_used: state.counters.skip_trace || 0,
      skip_traces_cap: SOFT_CAPS.skip_trace,
      monitored_used: state.counters.monitor || 0,
      monitored_cap: SOFT_CAPS.monitor,
    };
  }

  function buildEnvelope(type, correlationId, payload) {
    return {
      envelope_version: ENVELOPE_VERSION,
      message_id: createMessageId(),
      timestamp: nowIso(),
      source: "userscript",
      lane: LANE,
      type,
      correlation_id: correlationId || null,
      payload,
    };
  }

  function normalizeCommandEnvelope(raw) {
    if (Array.isArray(raw)) return raw.map(normalizeCommandEnvelope).filter(Boolean);
    if (!raw || typeof raw !== "object") return null;
    if (raw.envelope_version && raw.type) return raw;
    if (raw.message_id && raw.payload) {
      return {
        envelope_version: raw.envelope_version || ENVELOPE_VERSION,
        message_id: raw.message_id,
        timestamp: raw.timestamp || nowIso(),
        source: raw.source || "swarm",
        lane: raw.lane || raw.payload?.lane,
        type: raw.type || "command",
        correlation_id: raw.correlation_id || null,
        payload: raw.payload,
      };
    }
    return null;
  }

  function validateEnvelope(envelope) {
    if (!envelope) return "Envelope missing";
    if (envelope.type !== "command") return `Unexpected type: ${envelope.type}`;
    if (!envelope.message_id) return "message_id missing";
    if (!envelope.payload || typeof envelope.payload !== "object") {
      return "payload missing";
    }
    if (!envelope.payload.command_type) return "command_type missing";
    const commandType = envelope.payload.command_type;
    const originChannel = String(
      envelope.payload.origin_channel || envelope.payload.channel || "",
    ).toLowerCase();
    const isOperatorOverride =
      (commandType === "HALT" || commandType === "RESUME") &&
      originChannel.includes("alfred");
    if (envelope.lane !== LANE && !isOperatorOverride) return "lane mismatch";
    return null;
  }

  function isOutOfLaneCommand(envelope) {
    const lane = envelope?.lane || envelope?.payload?.lane;
    if (lane && lane !== LANE) return true;
    const originChannel = String(
      envelope?.payload?.origin_channel || envelope?.payload?.channel || "",
    ).toLowerCase();
    return originChannel.includes("land");
  }

  function regulatoryBlockHit(payload) {
    const stateCode = String(payload?.state || payload?.filters?.state || "")
      .trim()
      .toUpperCase();
    return stateCode && BLOCKED_STATES.has(stateCode);
  }

  function isDuplicateCommand(messageId) {
    return state.processedCommands.includes(messageId);
  }

  function markCommandProcessed(messageId) {
    state.processedCommands.push(messageId);
    state.processedCommands = state.processedCommands.slice(-1000);
  }

  async function emitError(correlationId, commandType, code, message, extras = {}) {
    const payload = {
      command_type: commandType,
      status: "failure",
      items: [],
      errors: [
        {
          code,
          message,
          item_ref: extras.item_ref || null,
          details: redactForLog(extras.details || {}),
        },
      ],
      quota_snapshot: buildQuotaSnapshot(),
    };
    const envelope = buildEnvelope("error", correlationId, payload);
    await safePostEnvelope(envelope);
    if (
      code === "SESSION_EXPIRED" ||
      code === "CAPTCHA_REQUIRED" ||
      code === "DOM_SELECTOR_MISSING" ||
      code === "RATE_LIMITED"
    ) {
      notify(`PropStream bridge: ${code}`, message);
    }
  }

  async function safePostEnvelope(envelope) {
    try {
      await Hermes.postEnvelope(envelope);
    } catch (error) {
      addLog("error", "hermes.post.failed", {
        error: String(error),
        envelope: redactForLog(envelope),
      });
    }
    if (envelope.type === "result" || envelope.type === "error") {
      await Discord.mirrorResult(envelope).catch(() => undefined);
    }
  }

  function normalizeScope(scope) {
    if (scope === "all") return "all";
    if (scope === "saves") return "saves";
    if (scope === "exports") return "exports";
    if (scope === "skip_trace" || scope === "skip-trace" || scope === "skip traces") {
      return "skip_trace";
    }
    if (scope === "monitor" || scope === "monitored") return "monitor";
    return String(scope || "").toLowerCase();
  }

  function isScopeHalted(scope) {
    return state.masterHalt || state.haltedScopes.has(normalizeScope(scope));
  }

  function scopeForCommand(commandType) {
    switch (commandType) {
      case "SAVE":
        return "saves";
      case "EXPORT":
        return "exports";
      case "SKIP_TRACE":
        return "skip_trace";
      default:
        return "all";
    }
  }

  function haltScope(scope) {
    const normalized = normalizeScope(scope);
    if (normalized === "all") {
      state.masterHalt = true;
    } else {
      state.haltedScopes.add(normalized);
    }
    persistState();
  }

  function shouldProtectivelyHalt(code) {
    return [
      "DOM_SELECTOR_MISSING",
      "ACTION_NOT_CONFIRMED",
      "CAPTCHA_REQUIRED",
      "SESSION_EXPIRED",
      "RATE_LIMITED",
      "QUOTA_CHECK_REQUIRED",
    ].includes(code);
  }

  function applyProtectiveHalt(commandType, code) {
    if (!shouldProtectivelyHalt(code)) return "none";
    if (code === "CAPTCHA_REQUIRED" || code === "SESSION_EXPIRED" || code === "RATE_LIMITED") {
      haltScope("all");
      return "all";
    }
    const scope = scopeForCommand(commandType);
    haltScope(scope);
    return scope;
  }

  async function applyThresholdAlerts(scope) {
    const used = state.counters[scope] || 0;
    const cap = SOFT_CAPS[scope];
    if (!cap) return;
    const pct = Math.floor((used / cap) * 100);
    state.thresholdState[scope] = state.thresholdState[scope] || [];
    for (const threshold of QUOTA_THRESHOLDS) {
      if (pct >= threshold && !state.thresholdState[scope].includes(threshold)) {
        state.thresholdState[scope].push(threshold);
        const text =
          `Quota threshold crossed for ${scope}: ${used}/${cap} (${pct}%).`;
        addLog("warn", "quota.threshold", { scope, used, cap, pct, threshold });
        await Discord.postQuotaAlert(`:warning: ${text}`).catch(() => undefined);
        await Discord.postAlfredAlert(`:warning: ${text}`).catch(() => undefined);
        await safePostEnvelope(
          buildEnvelope("result", null, {
            command_type: "QUOTA_CHECK",
            status: "partial",
            items: [{ scope, threshold, used, cap, percent: pct }],
            errors: [],
            quota_snapshot: buildQuotaSnapshot(),
          }),
        );
      }
    }
  }

  function incrementCounter(scope, amount = 1) {
    state.counters[scope] = (state.counters[scope] || 0) + amount;
    state.counters.operationsSinceQuotaCheck =
      (state.counters.operationsSinceQuotaCheck || 0) + amount;
    if (state.counters.remoteRemaining && typeof state.counters.remoteRemaining[scope] === "number") {
      state.counters.remoteRemaining[scope] = Math.max(
        0,
        state.counters.remoteRemaining[scope] - amount,
      );
    }
    persistState();
    return applyThresholdAlerts(scope);
  }

  async function guardCostBearingCommand(scope, commandCost = 1) {
    const normalized = normalizeScope(scope);
    if (state.masterHalt || isScopeHalted(normalized)) {
      throw buildBridgeError(
        "BRIDGE_HALTED",
        `Bridge halted for scope ${normalized}`,
      );
    }
    const localUsed = state.counters[normalized] || 0;
    const localCap = SOFT_CAPS[normalized];
    if (localCap && localUsed + commandCost > localCap) {
      throw buildBridgeError(
        "QUOTA_LOCAL_HALT",
        `Local soft cap would be exceeded for ${normalized}`,
      );
    }
    const remoteRemaining = state.counters.remoteRemaining;
    const reconciledAt = state.counters.reconciledAt
      ? new Date(state.counters.reconciledAt).getTime()
      : 0;
    const quotaCacheFresh = reconciledAt && Date.now() - reconciledAt <= QUOTA_CACHE_MAX_AGE_MS;
    const quotaCacheUsable =
      remoteRemaining &&
      typeof remoteRemaining[normalized] === "number" &&
      quotaCacheFresh &&
      (state.counters.operationsSinceQuotaCheck || 0) < 50;
    if (!quotaCacheUsable) {
      throw buildBridgeError(
        "QUOTA_CHECK_REQUIRED",
        `Run QUOTA_CHECK before executing ${normalized}`,
      );
    }
    if (remoteRemaining[normalized] < commandCost) {
      throw buildBridgeError(
        "QUOTA_REMOTE_EXHAUSTED",
        `PropStream reports no remaining capacity for ${normalized}`,
      );
    }
  }

  function buildBridgeError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  const Dom = {
    text(el) {
      return (el?.textContent || "").replace(/\s+/g, " ").trim();
    },

    matchesByText(elements, matcher) {
      return elements.find((el) => matcher.test(this.text(el)));
    },

    queryFirst(selectors, root = document) {
      for (const selector of selectors) {
        const found = root.querySelector(selector);
        if (found) return found;
      }
      return null;
    },

    queryAll(selectors, root = document) {
      for (const selector of selectors) {
        const found = Array.from(root.querySelectorAll(selector));
        if (found.length) return found;
      }
      return [];
    },

    queryAllMerged(selectors, root = document) {
      const merged = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
      return Array.from(new Set(merged));
    },

    isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    async waitFor(findFn, timeoutMs = DOM_WAIT_TIMEOUT_MS, intervalMs = DOM_POLL_INTERVAL_MS) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const result = findFn();
        if (result) return result;
        await delay(intervalMs);
      }
      throw buildBridgeError(
        "DOM_SELECTOR_MISSING",
        "Timed out waiting for required DOM element",
      );
    },

    async click(target) {
      const el = typeof target === "function" ? await target() : target;
      if (!el) {
        throw buildBridgeError("DOM_SELECTOR_MISSING", "Clickable element not found");
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await delay(100);
      el.click();
      return el;
    },

    async setInputValue(input, value) {
      if (!input) {
        throw buildBridgeError("DOM_SELECTOR_MISSING", "Input element not found");
      }
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    },

    findButtonByText(regex, root = document) {
      return this.matchesByText(
        Array.from(root.querySelectorAll("button, a, [role='button']")),
        regex,
      );
    },

    extractLabeledValue(labels, root = document.body) {
      const candidates = Array.from(root.querySelectorAll("dt, th, label, div, span"));
      for (const node of candidates) {
        const text = this.text(node).toLowerCase();
        if (labels.some((label) => text === label || text.includes(label))) {
          const sibling =
            node.nextElementSibling ||
            node.parentElement?.querySelector("dd, td, div:last-child, span:last-child");
          const siblingText = this.text(sibling);
          if (siblingText) return siblingText;
        }
      }
      return "";
    },

    detectCaptcha() {
      return Boolean(this.queryFirst(SELECTORS.captchaIndicators));
    },

    detectSessionExpired() {
      if (this.queryFirst(SELECTORS.sessionExpiredIndicators)) return true;
      return /sign in|log in/i.test(document.body.innerText.slice(0, 1500));
    },

    detectRateLimited() {
      return /rate limit|too many requests|slow down|temporarily blocked/i.test(
        document.body.innerText.slice(0, 2500),
      );
    },

    sanitizeDomStructure(maxNodes = 250) {
      let count = 0;
      const walk = (node, depth = 0) => {
        if (!node || count >= maxNodes) return [];
        if (node.nodeType !== Node.ELEMENT_NODE) return [];
        count += 1;
        const element = /** @type {HTMLElement} */ (node);
        const label = [
          element.tagName.toLowerCase(),
          element.id ? `#${element.id}` : "",
          element.getAttribute("role")
            ? `[role="${element.getAttribute("role")}"]`
            : "",
          element.getAttribute("data-testid")
            ? `[data-testid="${element.getAttribute("data-testid")}"]`
            : "",
          element.className && typeof element.className === "string"
            ? `.${element.className.split(/\s+/).slice(0, 2).join(".")}`
            : "",
        ].join("");
        const children = Array.from(element.children)
          .slice(0, 8)
          .flatMap((child) => walk(child, depth + 1));
        return [`${"  ".repeat(depth)}${label}`, ...children];
      };
      return walk(document.body).join("\n");
    },
  };

  const PropStream = {
    async ensureReady() {
      if (Dom.detectCaptcha()) {
        throw buildBridgeError("CAPTCHA_REQUIRED", "Captcha detected");
      }
      if (Dom.detectSessionExpired()) {
        throw buildBridgeError("SESSION_EXPIRED", "Session appears expired");
      }
      if (Dom.detectRateLimited()) {
        throw buildBridgeError("RATE_LIMITED", "PropStream appears to be rate limiting");
      }
      return true;
    },

    async openSearch() {
      const existing = Dom.queryFirst(SELECTORS.searchZipInputs);
      if (existing) return true;
      const nav =
        Dom.queryFirst(SELECTORS.searchPageLinks) ||
        Dom.findButtonByText(/search|properties|leads/i);
      if (nav) {
        await Dom.click(nav);
        await Dom.waitFor(() => Dom.queryFirst(SELECTORS.searchZipInputs));
      }
      return true;
    },

    async search(payload) {
      await this.ensureReady();
      await this.openSearch();
      const zipInput = await Dom.waitFor(() => Dom.queryFirst(SELECTORS.searchZipInputs));
      await Dom.setInputValue(zipInput, String(payload.zip || "").trim());
      await this.applyFilters(payload.filters || {});
      const applyButton =
        Dom.queryFirst(SELECTORS.applyButtons) ||
        Dom.findButtonByText(/apply|search|update/i);
      await Dom.click(applyButton);
      await randomizedDelay();
      const rows = await Dom.waitFor(
        () => Dom.queryAll(SELECTORS.resultRows).filter((row) => Dom.text(row)),
        DOM_WAIT_TIMEOUT_MS,
      );
      const results = await this.extractResults(rows, payload.max_results || 10);
      return {
        status: results.length ? "success" : "partial",
        items: results,
        errors: [],
      };
    },

    async applyFilters(filters) {
      if (!filters || typeof filters !== "object") return;
      const buttons = {
        sfr_detached: /single family|sfr|detached/i,
        vacant: /vacant/i,
        pre_foreclosure: /pre[-\s]?foreclosure/i,
        tax_delinquent: /tax delinquent/i,
        probate: /probate/i,
        code_violation: /code violation/i,
      };
      for (const [key, regex] of Object.entries(buttons)) {
        if (!filters[key]) continue;
        const button = Dom.findButtonByText(regex);
        if (button) {
          await Dom.click(button);
          await delay(150);
        }
      }
      if (filters.min_price || filters.max_price) {
        const priceInput =
          document.querySelector('input[placeholder*="min" i]') ||
          document.querySelector('input[name*="price" i]');
        if (priceInput) {
          const value = `${filters.min_price || ""}-${filters.max_price || ""}`;
          await Dom.setInputValue(priceInput, value);
        }
      }
    },

    parseAddress(text) {
      const parts = String(text || "").split(",").map((part) => part.trim());
      const [street = "", city = "", stateZip = ""] = parts;
      const stateZipMatch = stateZip.match(/([A-Z]{2})\s+(\d{5})/i) || [];
      return {
        address_full: text || "",
        address_street: street,
        address_city: city,
        address_state: (stateZipMatch[1] || "").toUpperCase(),
        address_zip: stateZipMatch[2] || "",
      };
    },

    extractDistressSignals(textBlob) {
      const normalized = String(textBlob || "").toLowerCase();
      const signals = [];
      if (/pre[-\s]?foreclosure|lis pendens|nod/.test(normalized)) signals.push("nod_filed");
      if (/tax delinquent|tax default/.test(normalized)) signals.push("tax_delinquent");
      if (/probate/.test(normalized)) signals.push("probate_filed");
      if (/code violation/.test(normalized)) signals.push("code_violation");
      if (/mls expired/.test(normalized)) signals.push("mls_expired");
      if (/mls withdrawn/.test(normalized)) signals.push("mls_withdrawn");
      if (/vacant|usps vacant/.test(normalized)) signals.push("usps_vacant");
      return Array.from(new Set(signals));
    },

    buildPropertyId(row) {
      return (
        row.getAttribute("data-id") ||
        row.getAttribute("data-property-id") ||
        row.dataset?.id ||
        createMessageId()
      );
    },

    async extractResults(rows, maxResults) {
      const results = [];
      for (const row of rows.slice(0, maxResults)) {
        const text = Dom.text(row);
        const link = row.querySelector(SELECTORS.detailLinks.join(", "));
        const addressLine =
          Dom.text(
            row.querySelector("a, h3, h4, [data-testid*='address'], [class*='address']"),
          ) || text.split(" | ")[0];
        const address = this.parseAddress(addressLine);
        results.push({
          property_id: this.buildPropertyId(row),
          ...address,
          lane: LANE,
          property_type: "single_family_residence_detached",
          square_feet: numericValue(text, /(sq\.?\s*ft|square feet)/i),
          bedrooms: numericValue(text, /\bbed/i),
          bathrooms: numericValue(text, /\bbath/i),
          year_built: numericValue(text, /year built/i),
          lot_size_sqft: numericValue(text, /lot size/i),
          last_sale_date: dateValue(text),
          last_sale_price: currencyValue(text),
          current_tax_assessment: currencyValue(text, /tax/i),
          parcel_number:
            row.getAttribute("data-apn") ||
            extractPattern(text, /\b(APN|Parcel)\s*:?\s*([A-Z0-9-]+)/i, 2),
          owner_name:
            extractPattern(text, /\bowner\s*:?\s*([A-Z ,.'-]+)/i, 1) || "",
          owner_type:
            extractPattern(text, /\b(LLC|Trust|Estate|Individual)\b/i, 1).toLowerCase() ||
            "",
          distress_signals: this.extractDistressSignals(text),
          property_detail_url: link?.href || "",
          photo_urls: Array.from(row.querySelectorAll("img"))
            .map((img) => img.src)
            .filter(Boolean),
          last_mls_status:
            extractPattern(text, /\b(active|withdrawn|expired|pending|sold)\b/i, 1) || "",
          lead_lifecycle_state: "new",
        });
      }
      return results;
    },

    async locateRowByPropertyId(propertyId) {
      const rows = Dom.queryAll(SELECTORS.resultRows);
      return (
        rows.find(
          (row) =>
            row.getAttribute("data-id") === propertyId ||
            row.getAttribute("data-property-id") === propertyId ||
            Dom.text(row).includes(propertyId),
        ) || null
      );
    },

    async save(payload) {
      await this.ensureReady();
      const items = [];
      const errors = [];
      for (const propertyId of payload.property_ids || []) {
        try {
          await randomizedDelay();
          const row = await this.locateRowByPropertyId(propertyId);
          if (!row) {
            throw buildBridgeError(
              "DOM_SELECTOR_MISSING",
              "Property row not found in current view",
              { item_ref: propertyId },
            );
          }
          const saveButton =
            row.querySelector(SELECTORS.saveButtons.join(", ")) ||
            Dom.findButtonByText(/save|saved|add to list/i, row);
          if (!saveButton) {
            throw buildBridgeError("DOM_SELECTOR_MISSING", "Save button missing", {
              item_ref: propertyId,
            });
          }
          if (this.isSaveConfirmed(row, saveButton)) {
            items.push({ property_id: propertyId, status: "success", idempotent: true });
            continue;
          }
          await Dom.click(saveButton);
          await delay(500);
          await this.chooseListIfModalPresent(payload.list_name);
          await this.waitForSaveConfirmation(row, saveButton);
          await incrementCounter("saves", 1);
          items.push({ property_id: propertyId, status: "success", verified: true });
        } catch (error) {
          errors.push({
            code: error.code || "UNKNOWN",
            message: error.message || "Save failed",
            item_ref: propertyId,
          });
        }
      }
      return {
        status: errors.length ? (items.length ? "partial" : "failure") : "success",
        items,
        errors,
      };
    },

    async chooseListIfModalPresent(listName) {
      if (!listName) return;
      const modalInput = Dom.queryFirst(SELECTORS.listPickerInputs);
      if (!modalInput) return;
      await Dom.setInputValue(modalInput, listName);
      await delay(300);
      const option = Dom.queryAll(SELECTORS.listPickerOptions).find((node) =>
        Dom.text(node).toLowerCase().includes(String(listName).toLowerCase()),
      );
      if (option) {
        option.click();
      }
      const confirm = Dom.findButtonByText(/save|confirm|done/i);
      if (confirm) {
        await Dom.click(confirm);
      }
    },

    async exportList(payload) {
      await this.ensureReady();
      await this.navigateToListByName(payload.list_name);
      const button =
        Dom.queryFirst(SELECTORS.exportButtons) || Dom.findButtonByText(/export/i);
      if (!button) {
        throw buildBridgeError("DOM_SELECTOR_MISSING", "Export button missing");
      }
      await Dom.click(button);
      await randomizedDelay();
      const exportResult = await this.captureExportResult();
      if (!exportResult.confirmed) {
        throw buildBridgeError(
          "ACTION_NOT_CONFIRMED",
          "Export was triggered but no verified completion signal was found",
        );
      }
      await incrementCounter("exports", 1);
      return {
        status: exportResult.records.length ? "success" : "partial",
        items: exportResult.records,
        errors: exportResult.records.length
          ? []
          : [
              {
                code: "EXPORT_CAPTURE_PARTIAL",
                message:
                  "Export completed but no downloadable CSV/XLSX payload could be captured",
                item_ref: payload.list_name || null,
              },
            ],
      };
    },

    async captureExportResult() {
      const confirmed = await Dom.waitFor(() => {
        const link = Dom.queryFirst(SELECTORS.exportDownloadLinks);
        if (link) return { kind: "download", node: link };
        const indicator = Dom.queryAllMerged(SELECTORS.exportReadyIndicators).find((node) =>
          /export|download|preparing|ready|queued/i.test(Dom.text(node)),
        );
        if (indicator) return { kind: "indicator", node: indicator };
        return null;
      }, 8_000).catch(() => null);
      if (!confirmed) {
        return { confirmed: false, records: [] };
      }
      const records =
        confirmed.kind === "download" ? await this.attemptCaptureCsvRecords(confirmed.node) : [];
      return { confirmed: true, records };
    },

    async attemptCaptureCsvRecords(linkNode = null) {
      const csvLink =
        linkNode ||
        Dom.queryFirst(SELECTORS.exportDownloadLinks) ||
        Array.from(document.querySelectorAll("a[href], button")).find((node) =>
          /(csv|xlsx|download)/i.test(node.href || Dom.text(node)),
        );
      if (csvLink?.href) {
        try {
          const response = await gmRequest({
            method: "GET",
            url: csvLink.href,
            // This request goes to PropStream/download infra, not Hermes.
            // Never forward Hermes auth headers or tokens to third-party origins.
            headers: { Accept: "text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*" },
            timeout: 30_000,
          });
          const text = response.responseText || "";
          return mapExportRows(parseCsv(text));
        } catch {
          return [];
        }
      }
      return [];
    },

    async skipTrace(payload) {
      await this.ensureReady();
      const items = [];
      const errors = [];
      for (const propertyId of payload.property_ids || []) {
        try {
          await randomizedDelay();
          const cached = runtime.inMemorySkipTraceCache.get(propertyId);
          if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            items.push({ ...cached.data, cached: true });
            continue;
          }
          const row = await this.locateRowByPropertyId(propertyId);
          if (!row) {
            throw buildBridgeError(
              "DOM_SELECTOR_MISSING",
              "Property row not found for skip trace",
              { item_ref: propertyId },
            );
          }
          const button =
            row.querySelector(SELECTORS.skipTraceButtons.join(", ")) ||
            Dom.findButtonByText(/skip trace/i, row);
          if (!button) {
            throw buildBridgeError("DOM_SELECTOR_MISSING", "Skip trace button missing", {
              item_ref: propertyId,
            });
          }
          await Dom.click(button);
          const container = await this.waitForSkipTraceContainer(row, propertyId);
          const data = this.extractSkipTraceContactsFromContainer(container, propertyId);
          runtime.inMemorySkipTraceCache.set(propertyId, {
            timestamp: Date.now(),
            data,
          });
          while (runtime.inMemorySkipTraceCache.size > MAX_IN_MEMORY_SKIP_TRACE_CACHE) {
            const firstKey = runtime.inMemorySkipTraceCache.keys().next().value;
            runtime.inMemorySkipTraceCache.delete(firstKey);
          }
          state.skipTraceMeta[propertyId] = { timestamp: Date.now() };
          await incrementCounter("skip_trace", 1);
          items.push(data);
        } catch (error) {
          errors.push({
            code: error.code || "UNKNOWN",
            message: error.message || "Skip trace failed",
            item_ref: propertyId,
          });
        }
      }
      persistState();
      return {
        status: errors.length ? (items.length ? "partial" : "failure") : "success",
        items,
        errors,
      };
    },

    async waitForSkipTraceContainer(row, propertyId) {
      return Dom.waitFor(() => {
        const containers = Dom.queryAllMerged(SELECTORS.skipTraceContainers).filter((node) => {
          if (!Dom.isVisible(node)) return false;
          if (row && row.contains(node)) return false;
          const text = Dom.text(node);
          return (
            /skip trace|contact|owner|phone|email/i.test(text) ||
            Dom.queryFirst(SELECTORS.skipTracePhoneNodes, node) ||
            Dom.queryFirst(SELECTORS.skipTraceEmailNodes, node)
          );
        });
        return containers[0] || null;
      }, 8_000).catch(() => {
        throw buildBridgeError(
          "ACTION_NOT_CONFIRMED",
          `Skip trace results region did not open for ${propertyId}`,
          { item_ref: propertyId },
        );
      });
    },

    extractSkipTraceContactsFromContainer(container, propertyId) {
      const blob = Dom.text(container);
      const phoneNodes = Array.from(
        container.querySelectorAll(SELECTORS.skipTracePhoneNodes.join(", ")),
      );
      const emailNodes = Array.from(
        container.querySelectorAll(SELECTORS.skipTraceEmailNodes.join(", ")),
      );
      const phones = Array.from(
        new Set(
          phoneNodes
            .map((node) => node.getAttribute("href") || Dom.text(node))
            .map((value) => String(value || "").replace(/^tel:/i, "").trim())
            .filter((value) => /\d{3}.*\d{3}.*\d{4}/.test(value)),
        ),
      ).slice(0, 10);
      const emails = Array.from(
        new Set(
          emailNodes
            .map((node) => node.getAttribute("href") || Dom.text(node))
            .map((value) => String(value || "").replace(/^mailto:/i, "").trim())
            .filter((value) => /@/.test(value)),
        ),
      ).slice(0, 10);
      const explicitNoResults = /no contacts|no phone|no email|no results|0 contacts/i.test(blob);
      if (!phones.length && !emails.length && !explicitNoResults) {
        throw buildBridgeError(
          "ACTION_NOT_CONFIRMED",
          `Skip trace region opened for ${propertyId} but no isolated contacts were found`,
          { item_ref: propertyId },
        );
      }
      return {
        property_id: propertyId,
        phone_numbers: phones.map((value) => ({ value, type: "unknown" })),
        email_addresses: emails,
        contacts_returned: phones.length + emails.length,
        no_results: explicitNoResults,
        status: "success",
      };
    },

    async quotaCheck() {
      const items = [await this.readQuotaCounters(true)];
      return { status: "success", items, errors: [] };
    },

    async readQuotaCounters(forceNavigation = false) {
      await this.ensureReady();
      if (forceNavigation) {
        await this.navigateToUsagePage();
      }
      const pageText = this.collectUsageText();
      const counters = {
        saves: extractQuota(pageText, /save/i),
        exports: extractQuota(pageText, /export/i),
        skip_trace: extractQuota(pageText, /skip trace/i),
        monitor: extractQuota(pageText, /monitor/i),
      };
      if (Object.values(counters).some((value) => value === null)) {
        throw buildBridgeError(
          "DOM_SELECTOR_MISSING",
          "Quota counters were not fully detected on the current page",
        );
      }
      const normalized = counters;
      state.counters.remoteRemaining = normalized;
      state.counters.reconciledAt = nowIso();
      state.counters.operationsSinceQuotaCheck = 0;
      reconcileCounters(normalized);
      persistState();
      return normalized;
    },

    collectUsageText() {
      const regions = Dom.queryAllMerged(SELECTORS.usageCounterRegions).filter((node) =>
        Dom.isVisible(node),
      );
      const chunks = regions
        .map((node) => Dom.text(node))
        .filter(Boolean)
        .filter((text) => /save|export|skip trace|monitor/i.test(text));
      if (chunks.length) return chunks.join("\n");
      return document.body.innerText || "";
    },

    async navigateToUsagePage() {
      if (state.config.propstreamUsageUrl) {
        window.location.assign(state.config.propstreamUsageUrl);
        await delay(2_000);
        return;
      }
      const link =
        Dom.queryFirst(SELECTORS.usageLinks) || Dom.findButtonByText(/account|billing|usage/i);
      if (link) {
        await Dom.click(link);
        await delay(2_000);
      }
    },

    async navigateToListByName(listName) {
      if (!listName) return;
      const button = Dom.findButtonByText(/saved|lists/i);
      if (button) {
        await Dom.click(button);
        await delay(1_000);
      }
      const listLink = Dom.matchesByText(
        Array.from(document.querySelectorAll("a, button, [role='button']")),
        new RegExp(escapeRegExp(listName), "i"),
      );
      if (listLink) {
        await Dom.click(listLink);
      }
    },

    stateTextFromNode(node) {
      return [
        Dom.text(node),
        node?.getAttribute?.("aria-label") || "",
        node?.getAttribute?.("title") || "",
        node?.getAttribute?.("data-state") || "",
        node?.getAttribute?.("aria-pressed") || "",
        typeof node?.className === "string" ? node.className : "",
      ]
        .join(" ")
        .toLowerCase();
    },

    isSaveConfirmed(row, button) {
      const text = [this.stateTextFromNode(button), this.stateTextFromNode(row)].join(" ");
      return /saved|unsave|remove from list|in list|aria-pressed true/.test(text);
    },

    async waitForSaveConfirmation(row, button) {
      const confirmed = await Dom.waitFor(
        () => (this.isSaveConfirmed(row, button) ? true : null),
        5_000,
      ).catch(() => null);
      if (!confirmed) {
        throw buildBridgeError(
          "ACTION_NOT_CONFIRMED",
          "Save click did not produce a verified saved state",
        );
      }
    },

  };

  function reconcileCounters(remoteRemaining) {
    const localRemaining = {
      saves: SOFT_CAPS.saves - (state.counters.saves || 0),
      exports: SOFT_CAPS.exports - (state.counters.exports || 0),
      skip_trace: SOFT_CAPS.skip_trace - (state.counters.skip_trace || 0),
      monitor: SOFT_CAPS.monitor - (state.counters.monitor || 0),
    };
    const drifted = Object.entries(remoteRemaining).filter(([key, remote]) => {
      const local = localRemaining[key];
      if (typeof remote !== "number" || typeof local !== "number") return false;
      if (remote === 0 && local === 0) return false;
      return Math.abs(local - remote) / Math.max(remote, 1) > 0.05;
    });
    if (drifted.length) {
      const message =
        `Quota reconciliation drift detected: ${drifted
          .map(([key]) => key)
          .join(", ")}. Trusting PropStream counters.`;
      addLog("warn", "quota.reconcile", {
        remoteRemaining,
        localRemaining,
        message,
      });
      Discord.postQuotaAlert(`:warning: ${message}`).catch(() => undefined);
      Discord.postAlfredAlert(`:warning: ${message}`).catch(() => undefined);
      Object.entries(remoteRemaining).forEach(([key, remaining]) => {
        if (typeof remaining === "number" && key in SOFT_CAPS) {
          state.counters[key] = Math.max(0, SOFT_CAPS[key] - remaining);
        }
      });
      state.counters.reconciledAt = nowIso();
      persistState();
    }
  }

  function parseCsv(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      return headers.reduce((acc, header, index) => {
        acc[header] = cells[index] || "";
        return acc;
      }, {});
    });
  }

  function csvValue(row, key) {
    return String(row?.[key] || "").trim();
  }

  function csvNumber(row, key) {
    const value = csvValue(row, key).replace(/[$,%\s]/g, "").replace(/,/g, "");
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function csvBooleanYesNo(row, key) {
    const value = csvValue(row, key).toLowerCase();
    if (value === "yes") return true;
    if (value === "no") return false;
    return null;
  }

  function normalizePropertyType(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("single family")) return "single_family_residence_detached";
    return normalized.replace(/\s+/g, "_") || "";
  }

  function composeOwnerName(row) {
    const owner1 = [csvValue(row, "Owner 1 First Name"), csvValue(row, "Owner 1 Last Name")]
      .filter(Boolean)
      .join(" ");
    const owner2 = [csvValue(row, "Owner 2 First Name"), csvValue(row, "Owner 2 Last Name")]
      .filter(Boolean)
      .join(" ");
    return [owner1, owner2].filter(Boolean).join(" & ");
  }

  function composeMailingAddress(row) {
    return [
      csvValue(row, "Mailing Care of Name"),
      csvValue(row, "Mailing Address"),
      csvValue(row, "Mailing Unit #"),
      csvValue(row, "Mailing City"),
      csvValue(row, "Mailing State"),
      csvValue(row, "Mailing Zip"),
    ]
      .filter(Boolean)
      .join(", ");
  }

  function buildPhoneNumbers(row) {
    const phones = [];
    for (let index = 1; index <= 5; index += 1) {
      const number = csvValue(row, `Phone ${index}`);
      if (!number) continue;
      phones.push({
        value: number,
        type: csvValue(row, `Phone ${index} Type`) || "unknown",
        dnc: csvBooleanYesNo(row, `Phone ${index} DNC`),
      });
    }
    return phones;
  }

  function buildEmailAddresses(row) {
    const emails = [];
    for (let index = 1; index <= 4; index += 1) {
      const email = csvValue(row, `Email ${index}`);
      if (email) emails.push(email);
    }
    return emails;
  }

  function deriveExportDistressSignals(row) {
    const signals = [];
    const mlsStatus = csvValue(row, "MLS Status").toUpperCase();
    if (mlsStatus === "EXPIRED") signals.push("mls_expired");
    if (mlsStatus === "WITHDRAWN") signals.push("mls_withdrawn");
    return signals;
  }

  function mapExportRows(rows) {
    return rows.map((row) => {
      const addressStreet = csvValue(row, "Address");
      const addressCity = csvValue(row, "City");
      const addressState = csvValue(row, "State");
      const addressZip = csvValue(row, "Zip");
      const phoneNumbers = buildPhoneNumbers(row);
      const emailAddresses = buildEmailAddresses(row);
      return {
        property_id:
          csvValue(row, "APN") ||
          [addressStreet, addressCity, addressState, addressZip].filter(Boolean).join("|"),
        lane: LANE,
        address_full: [addressStreet, addressCity, addressState, addressZip]
          .filter(Boolean)
          .join(", "),
        address_street: addressStreet,
        address_city: addressCity,
        address_state: addressState,
        address_zip: addressZip,
        parcel_number: csvValue(row, "APN"),
        property_type: normalizePropertyType(csvValue(row, "Property Type")),
        bedrooms: csvNumber(row, "Bedrooms"),
        bathrooms: csvNumber(row, "Total Bathrooms"),
        square_feet: csvNumber(row, "Building Sqft"),
        lot_size_sqft: csvNumber(row, "Lot Size Sqft"),
        year_built: csvNumber(row, "Effective Year Built"),
        current_tax_assessment: csvNumber(row, "Total Assessed Value"),
        last_sale_date: csvValue(row, "Last Sale Recording Date"),
        last_sale_price: csvNumber(row, "Last Sale Amount"),
        owner_name: composeOwnerName(row),
        owner_occupied: csvBooleanYesNo(row, "Owner Occupied"),
        owner_type: "",
        mailing_address: composeMailingAddress(row),
        do_not_mail: csvBooleanYesNo(row, "Do Not Mail"),
        phone_numbers: phoneNumbers,
        email_addresses: emailAddresses,
        contacts_returned: phoneNumbers.length + emailAddresses.length,
        litigator: csvBooleanYesNo(row, "Litigator"),
        mls_status: csvValue(row, "MLS Status"),
        distress_signals: deriveExportDistressSignals(row),
        propstream_arv_estimate: csvNumber(row, "Est. Value"),
        propstream_equity: csvNumber(row, "Est. Equity"),
        propstream_ltv: csvNumber(row, "Est. Loan-to-Value"),
        propstream_foreclosure_factor: csvValue(row, "Foreclosure Factor"),
        skip_trace_count: csvNumber(row, "Skip Traces"),
      };
    });
  }

  function splitCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map((value) => value.trim());
  }

  function numericValue(text, hintRegex = null) {
    const source = String(text || "");
    if (hintRegex) {
      const hint = source
        .split(/[\n|]/)
        .find((chunk) => hintRegex.test(chunk));
      if (hint) {
        const number = hint.match(/(\d[\d,]*)/);
        return number ? Number(number[1].replace(/,/g, "")) : null;
      }
    }
    const match = source.match(/(\d[\d,]*)/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function currencyValue(text, hintRegex = null) {
    const source = String(text || "");
    const chunks = hintRegex
      ? source.split(/[\n|]/).filter((chunk) => hintRegex.test(chunk))
      : [source];
    for (const chunk of chunks) {
      const match = chunk.match(/\$?\s?([\d,]{3,})/);
      if (match) return Number(match[1].replace(/,/g, ""));
    }
    return null;
  }

  function dateValue(text) {
    const match = String(text || "").match(
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/,
    );
    return match ? match[1] : "";
  }

  function extractPattern(text, regex, groupIndex = 1) {
    const match = String(text || "").match(regex);
    return match ? (match[groupIndex] || "").trim() : "";
  }

  function escapeRegExp(input) {
    return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractQuota(text, labelRegex) {
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      if (!labelRegex.test(line)) continue;
      const match = line.match(/(\d[\d,]*)\s*(?:\/|\bof\b)?\s*(\d[\d,]*)?/i);
      if (match) {
        const first = Number(match[1].replace(/,/g, ""));
        const second = match[2] ? Number(match[2].replace(/,/g, "")) : null;
        if (second !== null) {
          return Math.max(second - first, 0);
        }
        return first;
      }
    }
    return null;
  }

  async function handleCommand(envelope) {
    const validationError = validateEnvelope(envelope);
    const commandType = envelope?.payload?.command_type || "UNKNOWN";
    if (validationError) {
      await emitError(
        envelope?.message_id || null,
        commandType,
        "INVALID_COMMAND",
        validationError,
      );
      return;
    }
    if (isOutOfLaneCommand(envelope)) {
      await emitError(
        envelope.message_id,
        commandType,
        "OUT_OF_LANE_SCOPE",
        "Command targeted a non-houses lane",
      );
      return;
    }
    if (regulatoryBlockHit(envelope.payload)) {
      await emitError(
        envelope.message_id,
        commandType,
        "INVALID_COMMAND",
        "regulatory blocklist",
      );
      return;
    }
    if (isDuplicateCommand(envelope.message_id)) {
      addLog("info", "command.duplicate", { message_id: envelope.message_id });
      return;
    }
    await Discord.mirrorCommand(envelope).catch(() => undefined);
    addLog("info", "command.received", {
      command_type: commandType,
      message_id: envelope.message_id,
    });

    try {
      let result;
      runtime.inFlightCommandId = envelope.message_id;
      if (!isWithinOperatorWindow() && !["HALT", "RESUME", "PING", "QUOTA_CHECK"].includes(commandType)) {
        throw buildBridgeError(
          "OUTSIDE_OPERATOR_WINDOW",
          "Command refused outside the configured operator window",
        );
      }
      switch (commandType) {
        case "SEARCH":
          result = await PropStream.search(envelope.payload);
          break;
        case "SAVE":
          await guardCostBearingCommand("saves", (envelope.payload.property_ids || []).length || 1);
          result = await PropStream.save(envelope.payload);
          break;
        case "EXPORT":
          await guardCostBearingCommand("exports", 1);
          result = await PropStream.exportList(envelope.payload);
          break;
        case "SKIP_TRACE":
          await guardCostBearingCommand(
            "skip_trace",
            (envelope.payload.property_ids || []).length || 1,
          );
          result = await PropStream.skipTrace(envelope.payload);
          break;
        case "QUOTA_CHECK":
          result = await PropStream.quotaCheck();
          break;
        case "HALT":
          result = handleHalt(envelope.payload);
          break;
        case "RESUME":
          result = handleResume(envelope.payload);
          break;
        case "PING":
          result = buildHeartbeatPayload("success");
          break;
        default:
          throw buildBridgeError(
            "INVALID_COMMAND",
            `Unsupported command type ${commandType}`,
          );
      }
      runtime.lastSuccessfulCommandAt = nowIso();
      const payload =
        commandType === "PING"
          ? result
          : {
              command_type: commandType,
              status: result.status || "success",
              items: result.items || [],
              errors: result.errors || [],
              quota_snapshot: buildQuotaSnapshot(),
            };
      const envelopeOut = buildEnvelope(
        commandType === "PING" ? "heartbeat" : "result",
        envelope.message_id,
        payload,
      );
      await safePostEnvelope(envelopeOut);
      if (commandType === "QUOTA_CHECK") {
        await Discord.mirrorQuota(payload).catch(() => undefined);
      }
      markCommandProcessed(envelope.message_id);
      state.lastCommandId = envelope.message_id;
      persistState();
    } catch (error) {
      const code = error.code || "UNKNOWN";
      const haltedScope = applyProtectiveHalt(commandType, code);
      const details =
        code === "DOM_SELECTOR_MISSING"
          ? { dom_snapshot: Dom.sanitizeDomStructure() }
          : error.details || {};
      addLog("error", "command.failed", {
        command_type: commandType,
        error: String(error.message || error),
        code,
      });
      await emitError(
        envelope.message_id,
        commandType,
        code,
        error.message || "Unknown error",
        { details: { ...details, halted_scope: haltedScope } },
      );
      if (
        code === "DOM_SELECTOR_MISSING" ||
        code === "ACTION_NOT_CONFIRMED" ||
        code === "SESSION_EXPIRED" ||
        code === "CAPTCHA_REQUIRED" ||
        code === "RATE_LIMITED" ||
        code === "QUOTA_CHECK_REQUIRED"
      ) {
        await Discord.postAlfredAlert(
          [
            `:rotating_light: ${code} during ${commandType}. Protective halt applied: ${haltedScope}.`,
            code === "DOM_SELECTOR_MISSING"
              ? `\`\`\`\n${truncate(Dom.sanitizeDomStructure(), 1500)}\n\`\`\``
              : truncate(error.message || "Unknown error", 1500),
          ].join("\n"),
        ).catch(() => undefined);
      }
    } finally {
      runtime.inFlightCommandId = null;
      renderStatus();
    }
  }

  function handleHalt(payload) {
    const scope = normalizeScope(payload.scope || "all");
    if (scope === "all") {
      state.masterHalt = true;
    } else {
      state.haltedScopes.add(scope);
    }
    persistState();
    return {
      command_type: "HALT",
      status: "success",
      items: [{ scope, halted: true }],
      errors: [],
    };
  }

  function handleResume(payload) {
    const scope = normalizeScope(payload.scope || "all");
    if (scope === "all") {
      state.masterHalt = false;
      state.haltedScopes.clear();
    } else {
      state.haltedScopes.delete(scope);
    }
    persistState();
    return {
      command_type: "RESUME",
      status: "success",
      items: [{ scope, halted: false }],
      errors: [],
    };
  }

  function buildHeartbeatPayload(status = "success") {
    return {
      command_type: "PING",
      status,
      items: [
        {
          script_version: SCRIPT_VERSION,
          uptime_seconds: Math.floor((Date.now() - runtime.startedAt) / 1000),
          last_successful_command_at: runtime.lastSuccessfulCommandAt,
          queue_depth: runtime.queueDepth,
          master_halt: state.masterHalt,
          halted_scopes: Array.from(state.haltedScopes),
        },
      ],
      errors: [],
      quota_snapshot: buildQuotaSnapshot(),
    };
  }

  async function sendHeartbeat(forceDiscordMirror = false) {
    const envelope = buildEnvelope("heartbeat", null, buildHeartbeatPayload("success"));
    await safePostEnvelope(envelope);
    const now = Date.now();
    if (forceDiscordMirror || now - state.lastDiscordHeartbeatAt >= DISCORD_HEARTBEAT_MS) {
      state.lastDiscordHeartbeatAt = now;
      persistState();
      await Discord.mirrorResult(
        buildEnvelope("result", null, {
          command_type: "HEARTBEAT",
          status: "success",
          items: buildHeartbeatPayload("success").items,
          errors: [],
          quota_snapshot: buildQuotaSnapshot(),
        }),
      ).catch(() => undefined);
    }
  }

  async function pollLoop() {
    if (!state.config.hermesPollUrl || !state.config.hermesEventUrl) {
      addLog("warn", "config.missing", {
        message: "Hermes URLs are not configured yet",
      });
      return;
    }
    try {
      const raw = await Hermes.poll();
      const envelopes = Array.isArray(raw)
        ? raw.map(normalizeCommandEnvelope).filter(Boolean)
        : [normalizeCommandEnvelope(raw)].filter(Boolean);
      runtime.queueDepth = envelopes.length;
      for (const envelope of envelopes) {
        await handleCommand(envelope);
      }
    } catch (error) {
      addLog("error", "poll.failed", { error: String(error) });
    } finally {
      renderStatus();
      schedulePoll();
    }
  }

  function schedulePoll() {
    clearTimeout(runtime.pollTimer);
    const interval =
      state.config.pollMode === "short"
        ? Number(state.config.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS
        : 250;
    runtime.pollTimer = setTimeout(() => {
      pollLoop().catch(() => undefined);
    }, interval);
  }

  function mountPanel() {
    if (runtime.panelMounted) return;
    runtime.panelMounted = true;
    GM_addStyle(`
      #pssb-launcher { position: fixed; top: 14px; right: 14px; z-index: 999999; background: #111827; color: #fff; border: 1px solid #374151; border-radius: 999px; padding: 8px 12px; font: 12px/1.2 sans-serif; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
      #pssb-panel { position: fixed; top: 52px; right: 14px; width: 380px; max-height: 80vh; overflow: auto; z-index: 999999; background: rgba(17,24,39,.98); color: #fff; border: 1px solid #374151; border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.35); padding: 14px; font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; display: none; }
      #pssb-panel h3 { margin: 0 0 8px; font-size: 14px; }
      #pssb-panel label { display: block; margin-top: 8px; color: #d1d5db; }
      #pssb-panel input, #pssb-panel select, #pssb-panel textarea { width: 100%; margin-top: 4px; border-radius: 8px; border: 1px solid #4b5563; background: #111827; color: #fff; padding: 8px; box-sizing: border-box; }
      #pssb-panel button { margin-top: 8px; margin-right: 8px; border-radius: 8px; border: 1px solid #4b5563; background: #1f2937; color: #fff; padding: 8px 10px; cursor: pointer; }
      #pssb-status { padding: 10px; border-radius: 10px; background: rgba(31,41,55,.8); margin-bottom: 10px; white-space: pre-wrap; }
      #pssb-logs { padding: 10px; border-radius: 10px; background: rgba(31,41,55,.8); max-height: 220px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      #pssb-logs .entry { margin-bottom: 8px; border-bottom: 1px solid rgba(75,85,99,.45); padding-bottom: 6px; }
      #pssb-banner { margin-bottom: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(127,29,29,.95); display: none; }
    `);

    const launcher = document.createElement("button");
    launcher.id = "pssb-launcher";
    launcher.textContent = "Swarm Bridge";

    const panel = document.createElement("div");
    panel.id = "pssb-panel";
    panel.innerHTML = `
      <div id="pssb-banner"></div>
      <h3>PropStream x Swarm Bridge</h3>
      <div id="pssb-status">Loading status…</div>
      <label>Hermes poll URL <input id="pssb-hermes-poll-url" type="text" /></label>
      <label>Hermes event URL <input id="pssb-hermes-event-url" type="text" /></label>
      <label>Hermes heartbeat URL <input id="pssb-hermes-heartbeat-url" type="text" /></label>
      <label>Auth mode
        <select id="pssb-auth-type">
          <option value="bearer">Bearer</option>
          <option value="custom_header">Custom header</option>
          <option value="none">None</option>
        </select>
      </label>
      <label>Auth header name <input id="pssb-auth-header-name" type="text" /></label>
      <label>Auth token <input id="pssb-auth-token" type="password" /></label>
      <label>Poll mode
        <select id="pssb-poll-mode">
          <option value="long">Long poll</option>
          <option value="short">Short poll</option>
        </select>
      </label>
      <label>Short poll interval (ms) <input id="pssb-poll-interval" type="number" min="1000" step="500" /></label>
      <label>Long poll timeout (ms) <input id="pssb-long-poll-timeout" type="number" min="5000" step="1000" /></label>
	      <label>Commands webhook <input id="pssb-discord-commands-webhook" type="password" /></label>
	      <label>Results webhook <input id="pssb-discord-results-webhook" type="password" /></label>
	      <label>PropStream quota webhook <input id="pssb-discord-quota-webhook" type="password" /></label>
	      <label>Alfred alert webhook <input id="pssb-discord-alfred-webhook" type="password" /></label>
      <label>Usage page URL override <input id="pssb-usage-url" type="text" /></label>
      <label>Timezone <input id="pssb-timezone" type="text" /></label>
      <label>Operator window start hour <input id="pssb-hours-start" type="number" min="0" max="23" /></label>
      <label>Operator window end hour <input id="pssb-hours-end" type="number" min="1" max="24" /></label>
      <label><input id="pssb-enable-hours" type="checkbox" style="width:auto;margin-right:8px;" /> Restrict to operator hours</label>
      <div>
        <button id="pssb-save-config">Save config</button>
        <button id="pssb-poll-now">Poll now</button>
        <button id="pssb-quota-check">Quota check</button>
        <button id="pssb-halt-all">HALT all</button>
        <button id="pssb-resume-all">RESUME all</button>
        <button id="pssb-reset-counters">Reset counters</button>
        <button id="pssb-dump-log">Dump log</button>
      </div>
      <h3>Rolling log</h3>
      <div id="pssb-logs"></div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    launcher.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
      renderPanelValues();
      renderStatus();
      renderLogs();
    });

    bindPanelActions();
    renderPanelValues();
    renderStatus();
    renderLogs();
  }

  function bindPanelActions() {
    byId("pssb-save-config").addEventListener("click", () => {
      state.config = {
        ...state.config,
        hermesPollUrl: valueOf("pssb-hermes-poll-url"),
        hermesEventUrl: valueOf("pssb-hermes-event-url"),
        hermesHeartbeatUrl: valueOf("pssb-hermes-heartbeat-url"),
        authType: valueOf("pssb-auth-type"),
        authHeaderName: valueOf("pssb-auth-header-name"),
        authToken: valueOf("pssb-auth-token"),
        pollMode: valueOf("pssb-poll-mode"),
        pollIntervalMs: Number(valueOf("pssb-poll-interval")) || DEFAULT_POLL_INTERVAL_MS,
        longPollTimeoutMs:
          Number(valueOf("pssb-long-poll-timeout")) || DEFAULT_LONG_POLL_TIMEOUT_MS,
        discordCommandsWebhook: valueOf("pssb-discord-commands-webhook"),
        discordResultsWebhook: valueOf("pssb-discord-results-webhook"),
        discordQuotaWebhook: valueOf("pssb-discord-quota-webhook"),
        discordAlfredWebhook: valueOf("pssb-discord-alfred-webhook"),
        propstreamUsageUrl: valueOf("pssb-usage-url"),
        timezone: valueOf("pssb-timezone"),
        operatorHoursStart: Number(valueOf("pssb-hours-start")) || OPERATOR_HOURS.start,
        operatorHoursEnd: Number(valueOf("pssb-hours-end")) || OPERATOR_HOURS.end,
        enableOperatorHours: byId("pssb-enable-hours").checked,
      };
      persistState();
      addLog("info", "config.saved", { config: redactForLog(state.config) });
      renderStatus("Config saved");
      schedulePoll();
    });

    byId("pssb-poll-now").addEventListener("click", () => {
      pollLoop().catch(() => undefined);
    });

    byId("pssb-quota-check").addEventListener("click", async () => {
      try {
        const result = await PropStream.quotaCheck();
        await safePostEnvelope(
          buildEnvelope("result", null, {
            command_type: "QUOTA_CHECK",
            status: result.status,
            items: result.items,
            errors: result.errors,
            quota_snapshot: buildQuotaSnapshot(),
          }),
        );
        await Discord.mirrorQuota({
          command_type: "QUOTA_CHECK",
          status: result.status,
          items: result.items,
          errors: result.errors,
          quota_snapshot: buildQuotaSnapshot(),
        }).catch(() => undefined);
      } catch (error) {
        await emitError(null, "QUOTA_CHECK", error.code || "UNKNOWN", error.message);
      }
    });

    byId("pssb-halt-all").addEventListener("click", () => {
      state.masterHalt = true;
      persistState();
      renderStatus("Bridge halted");
    });

    byId("pssb-resume-all").addEventListener("click", () => {
      state.masterHalt = false;
      state.haltedScopes.clear();
      persistState();
      renderStatus("Bridge resumed");
    });

    byId("pssb-reset-counters").addEventListener("click", () => {
      state.counters = buildEmptyCounters();
      state.thresholdState = {};
      persistState();
      renderStatus("Counters reset");
    });

    byId("pssb-dump-log").addEventListener("click", () => {
      const logs = getLogs();
      const blob = new Blob([JSON.stringify(logs, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "propstream-swarm-bridge-log.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function valueOf(id) {
    return byId(id)?.value || "";
  }

  function renderPanelValues() {
    const fields = {
      "pssb-hermes-poll-url": state.config.hermesPollUrl,
      "pssb-hermes-event-url": state.config.hermesEventUrl,
      "pssb-hermes-heartbeat-url": state.config.hermesHeartbeatUrl,
      "pssb-auth-type": state.config.authType,
      "pssb-auth-header-name": state.config.authHeaderName,
      "pssb-auth-token": state.config.authToken,
      "pssb-poll-mode": state.config.pollMode,
      "pssb-poll-interval": state.config.pollIntervalMs,
      "pssb-long-poll-timeout": state.config.longPollTimeoutMs,
      "pssb-discord-commands-webhook": state.config.discordCommandsWebhook,
      "pssb-discord-results-webhook": state.config.discordResultsWebhook,
      "pssb-discord-quota-webhook": state.config.discordQuotaWebhook,
      "pssb-discord-alfred-webhook": state.config.discordAlfredWebhook,
      "pssb-usage-url": state.config.propstreamUsageUrl,
      "pssb-timezone": state.config.timezone,
      "pssb-hours-start": state.config.operatorHoursStart,
      "pssb-hours-end": state.config.operatorHoursEnd,
    };
    Object.entries(fields).forEach(([id, value]) => {
      const field = byId(id);
      if (field) field.value = value || "";
    });
    if (byId("pssb-enable-hours")) {
      byId("pssb-enable-hours").checked = Boolean(state.config.enableOperatorHours);
    }
  }

  function renderStatus(message = "") {
    const statusNode = byId("pssb-status");
    const banner = byId("pssb-banner");
    if (!statusNode) return;
    const quota = buildQuotaSnapshot();
    statusNode.textContent = [
      `Version: ${SCRIPT_VERSION}`,
      `Master halt: ${state.masterHalt ? "ON" : "OFF"}`,
      `Halted scopes: ${Array.from(state.haltedScopes).join(", ") || "none"}`,
      `Queue depth: ${runtime.queueDepth}`,
      `In-flight command: ${runtime.inFlightCommandId || "none"}`,
      `Last success: ${runtime.lastSuccessfulCommandAt || "never"}`,
      `Operator window OK: ${isWithinOperatorWindow() ? "yes" : "no"}`,
      `Saves ${quota.saves_used}/${quota.saves_cap}`,
      `Exports ${quota.exports_used}/${quota.exports_cap}`,
      `Skip traces ${quota.skip_traces_used}/${quota.skip_traces_cap}`,
      `Monitored ${quota.monitored_used}/${quota.monitored_cap}`,
      message ? `Note: ${message}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (banner) {
      const issues = [];
      if (!state.config.hermesPollUrl || !state.config.hermesEventUrl) {
        issues.push("Hermes URLs missing");
      }
      if (!state.config.discordCommandsWebhook || !state.config.discordResultsWebhook) {
        issues.push("Discord webhooks missing");
      }
      if (!state.config.discordQuotaWebhook) {
        issues.push("Quota webhook missing");
      }
      if (!state.config.discordAlfredWebhook) {
        issues.push("Alfred webhook missing");
      }
      if (state.masterHalt) issues.push("Bridge halted");
      banner.style.display = issues.length ? "block" : "none";
      banner.textContent = issues.join(" | ");
    }
  }

  function renderLogs() {
    const logsNode = byId("pssb-logs");
    if (!logsNode) return;
    logsNode.innerHTML = getLogs()
      .slice(-50)
      .reverse()
      .map(
        (entry) =>
          `<div class="entry"><strong>${escapeHtml(entry.at)}</strong> [${escapeHtml(
            entry.level,
          )}] ${escapeHtml(entry.event)}<br><code>${escapeHtml(
            JSON.stringify(entry.details),
          )}</code></div>`,
      )
      .join("");
  }

  function escapeHtml(input) {
    return String(input || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  async function bootstrap() {
    mountPanel();
    addLog("info", "bridge.started", {
      version: SCRIPT_VERSION,
      href: window.location.href,
    });
    persistState();
    sendHeartbeat(true).catch(() => undefined);
    runtime.heartbeatTimer = setInterval(() => {
      sendHeartbeat(false).catch(() => undefined);
    }, IDLE_HEARTBEAT_MS);
    runtime.discordHeartbeatTimer = setInterval(() => {
      sendHeartbeat(true).catch(() => undefined);
    }, DISCORD_HEARTBEAT_MS);
    schedulePoll();
  }

  bootstrap().catch((error) => {
    addLog("error", "bridge.bootstrap.failed", { error: String(error) });
    notify("PropStream bridge bootstrap failed", String(error));
  });
})();
