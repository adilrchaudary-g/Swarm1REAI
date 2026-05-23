import path from "node:path";
import fs from "node:fs";

const repoEnv = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", ".env");
if (fs.existsSync(repoEnv)) {
  for (const line of fs.readFileSync(repoEnv, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function boolFromEnv(input: string | undefined, fallback: boolean) {
  if (input == null || input === "") return fallback;
  return /^(1|true|yes|on)$/i.test(input);
}

function numberFromEnv(input: string | undefined, fallback: number) {
  if (!input) return fallback;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const repoRoot = path.resolve(appRoot, "..");
const runtimeRoot = path.join(appRoot, ".runtime");

export type RunnerConfig = {
  appRoot: string;
  runtimeRoot: string;
  artifactsDir: string;
  downloadsDir: string;
  userDataDir: string;
  browserChannel: "chromium" | "chrome";
  allowNativeKeychain: boolean;
  chromeUserDataDir: string;
  storageStatePath: string;
  statePath: string;
  baseUrl: string;
  headless: boolean;
  pollMode: "long" | "short";
  pollIntervalMs: number;
  longPollTimeoutMs: number;
  heartbeatMs: number;
  operatorTimezone: string;
  enableOperatorHours: boolean;
  operatorHoursStart: number;
  operatorHoursEnd: number;
  hermesPollUrl: string;
  hermesEventUrl: string;
  hermesHeartbeatUrl: string;
  hermesAuthType: "bearer" | "custom" | "none";
  hermesAuthHeaderName: string;
  hermesAuthToken: string;
  hermesAuthPrefix: string;
  discordCommandsWebhook: string;
  discordResultsWebhook: string;
  discordQuotaWebhook: string;
  discordAlfredWebhook: string;
  supervisorMode: "rule-based" | "openai";
  openaiApiKey: string;
  openaiModel: string;
  harvestArchiveRoot: string;
  propstreamUsername?: string;
  propstreamPassword?: string;
  sessionStrategy: "auto" | "cdp" | "persistent" | "cookie-injection";
  cdpPort: number;
  cdpAutoLaunch: boolean;
  sessionRefreshMarginMs: number;
  chromeCookiesDbPath: string;
  cookieStorePath: string;
  caseNetBaseUrl: string;
  courtRecordsArchiveRoot: string;
  fsboArchiveRoot: string;
};

export function loadConfig(): RunnerConfig {
  return {
    appRoot,
    runtimeRoot,
    artifactsDir: path.join(runtimeRoot, "artifacts"),
    downloadsDir: path.join(runtimeRoot, "downloads"),
    userDataDir: process.env.PROPSTREAM_USER_DATA_DIR || path.join(runtimeRoot, "profile"),
    browserChannel: process.env.PROPSTREAM_BROWSER_CHANNEL === "chrome" ? "chrome" : "chromium",
    allowNativeKeychain:
      process.platform === "darwin" && boolFromEnv(process.env.PROPSTREAM_ALLOW_NATIVE_KEYCHAIN, true),
    chromeUserDataDir:
      process.env.PROPSTREAM_CHROME_USER_DATA_DIR ||
      path.join(process.env.HOME || "~", "Library", "Application Support", "Google", "Chrome"),
    storageStatePath: path.join(runtimeRoot, "storage-state.json"),
    statePath: path.join(runtimeRoot, "state.json"),
    baseUrl: process.env.PROPSTREAM_BASE_URL || "https://app.propstream.com",
    headless: boolFromEnv(process.env.PROPSTREAM_HEADLESS, true),
    pollMode: process.env.HERMES_POLL_MODE === "short" ? "short" : "long",
    pollIntervalMs: numberFromEnv(process.env.HERMES_POLL_INTERVAL_MS, 10_000),
    longPollTimeoutMs: numberFromEnv(process.env.HERMES_LONG_POLL_TIMEOUT_MS, 30_000),
    heartbeatMs: numberFromEnv(process.env.PROPSTREAM_HEARTBEAT_MS, 60_000),
    operatorTimezone: process.env.OPERATOR_TIMEZONE || "America/New_York",
    enableOperatorHours: boolFromEnv(process.env.OPERATOR_HOURS_ENABLED, true),
    operatorHoursStart: numberFromEnv(process.env.OPERATOR_HOURS_START, 8),
    operatorHoursEnd: numberFromEnv(process.env.OPERATOR_HOURS_END, 23),
    hermesPollUrl: process.env.HERMES_POLL_URL || "",
    hermesEventUrl: process.env.HERMES_EVENT_URL || "",
    hermesHeartbeatUrl: process.env.HERMES_HEARTBEAT_URL || "",
    hermesAuthType:
      process.env.HERMES_AUTH_TYPE === "custom"
        ? "custom"
        : process.env.HERMES_AUTH_TYPE === "none"
          ? "none"
          : "bearer",
    hermesAuthHeaderName: process.env.HERMES_AUTH_HEADER_NAME || "Authorization",
    hermesAuthToken: process.env.HERMES_AUTH_TOKEN || "",
    hermesAuthPrefix: process.env.HERMES_AUTH_PREFIX || "Bearer ",
    discordCommandsWebhook: process.env.DISCORD_COMMANDS_WEBHOOK || "",
    discordResultsWebhook: process.env.DISCORD_RESULTS_WEBHOOK || "",
    discordQuotaWebhook: process.env.DISCORD_QUOTA_WEBHOOK || "",
    discordAlfredWebhook: process.env.DISCORD_ALFRED_WEBHOOK || "",
    supervisorMode: process.env.SUPERVISOR_MODE === "openai" ? "openai" : "rule-based",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-5-mini",
    harvestArchiveRoot:
      process.env.PROPSTREAM_ARCHIVE_ROOT ||
      path.join(repoRoot, "lead-vault", "acquisition", "propstream"),
    propstreamUsername: process.env.PROPSTREAM_USERNAME || "",
    propstreamPassword: process.env.PROPSTREAM_PASSWORD || "",
    sessionStrategy: (() => {
      const v = process.env.PROPSTREAM_SESSION_STRATEGY;
      if (v === "cdp" || v === "persistent" || v === "cookie-injection") return v;
      return "auto" as const;
    })(),
    cdpPort: numberFromEnv(process.env.PROPSTREAM_CDP_PORT, 9222),
    cdpAutoLaunch: boolFromEnv(process.env.PROPSTREAM_CDP_AUTO_LAUNCH, true),
    sessionRefreshMarginMs: numberFromEnv(process.env.PROPSTREAM_SESSION_REFRESH_MARGIN_MS, 3_600_000),
    chromeCookiesDbPath:
      process.env.PROPSTREAM_CHROME_COOKIES_DB ||
      path.join(
        process.env.PROPSTREAM_CHROME_USER_DATA_DIR ||
          path.join(process.env.HOME || "~", "Library", "Application Support", "Google", "Chrome"),
        "Default",
        "Cookies",
      ),
    cookieStorePath: path.join(runtimeRoot, "cookie-store.json"),
    caseNetBaseUrl: process.env.CASENET_BASE_URL || "https://www.courts.mo.gov/cnet",
    courtRecordsArchiveRoot:
      process.env.COURT_RECORDS_ARCHIVE_ROOT ||
      path.join(repoRoot, "lead-vault", "acquisition", "court-records"),
    fsboArchiveRoot:
      process.env.FSBO_ARCHIVE_ROOT ||
      path.join(repoRoot, "lead-vault", "acquisition", "fsbo"),
  };
}
