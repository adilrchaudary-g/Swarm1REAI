import type { RunnerConfig } from "../config.js";
import type { SessionProvider } from "./providers/types.js";
import { CdpSessionProvider } from "./providers/cdp-provider.js";
import { PersistentSessionProvider } from "./providers/persistent-provider.js";
import { CookieInjectionProvider } from "./providers/cookie-injection-provider.js";
import { checkCookieHealth, checkPageHealth } from "./session-health.js";
import { CookieStore } from "./cookie-store.js";
import { ensureDir } from "../utils/fs.js";

type TrackName = "cdp" | "persistent" | "cookie-injection";

type TrackResult = {
  track: TrackName;
  preflightValid: boolean;
  preflightReason: string;
  authSucceeded: boolean;
  timeToAuthMs: number;
  survivesRestart: boolean;
  cookieCount: number;
  hasAuthToken: boolean;
  hasJsessionId: boolean;
  canPerformSearch: boolean;
  storeSnapshotsAfter: number;
  storeValidAfter: number;
  errors: string[];
};

function createProvider(track: TrackName, config: RunnerConfig): SessionProvider {
  switch (track) {
    case "cdp":
      return new CdpSessionProvider(config);
    case "persistent":
      return new PersistentSessionProvider(config);
    case "cookie-injection":
      return new CookieInjectionProvider(config);
  }
}

async function benchmarkTrack(
  track: TrackName,
  config: RunnerConfig,
  store: CookieStore,
): Promise<TrackResult> {
  const result: TrackResult = {
    track,
    preflightValid: false,
    preflightReason: "",
    authSucceeded: false,
    timeToAuthMs: 0,
    survivesRestart: false,
    cookieCount: 0,
    hasAuthToken: false,
    hasJsessionId: false,
    canPerformSearch: false,
    storeSnapshotsAfter: 0,
    storeValidAfter: 0,
    errors: [],
  };

  let provider: SessionProvider | null = null;

  try {
    // ── Pre-flight: validate store before launching browser ──────
    const preflight = await store.preflight(config.sessionRefreshMarginMs);
    result.preflightValid = preflight.valid;
    result.preflightReason = preflight.reason;
    console.log(
      `  Preflight: ${preflight.valid ? "VALID" : "INVALID"} — ${preflight.reason}` +
        (preflight.secondsUntilExpiry !== null
          ? ` (${Math.floor(preflight.secondsUntilExpiry / 3600)}h ${Math.floor((preflight.secondsUntilExpiry % 3600) / 60)}m remaining)`
          : ""),
    );

    // ── Phase 1: Fresh start auth ────────────────────────────────
    provider = createProvider(track, config);
    const startMs = Date.now();

    const page = await provider.start();
    result.timeToAuthMs = Date.now() - startMs;

    const ctx = provider.getContext();
    if (!ctx) {
      result.errors.push("No browser context after start()");
      return result;
    }

    const health = await checkCookieHealth(ctx);
    const pageHealth = await checkPageHealth(page);

    result.authSucceeded = health.isAuthenticated && !pageHealth.authRequired;
    result.hasAuthToken = health.authTokenPresent;
    result.hasJsessionId = health.jsessionPresent;

    const allCookies = await ctx.cookies();
    result.cookieCount = allCookies.length;

    // ── Phase 2: Restart survival ────────────────────────────────
    await provider.saveStorageState(config.storageStatePath);
    await provider.close();
    provider = null;

    await new Promise((r) => setTimeout(r, 2_000));

    provider = createProvider(track, config);
    const restartPage = await provider.start();
    const restartCtx = provider.getContext();

    if (restartCtx) {
      const restartHealth = await checkCookieHealth(restartCtx);
      const restartPageHealth = await checkPageHealth(restartPage);
      result.survivesRestart = restartHealth.isAuthenticated && !restartPageHealth.authRequired;
    }

    // ── Phase 3: Can perform search ──────────────────────────────
    if (result.survivesRestart || result.authSucceeded) {
      try {
        const searchPage = await provider.getPage();
        const currentUrl = searchPage.url();

        if (!/\/search/i.test(currentUrl)) {
          await searchPage.goto(`${config.baseUrl}/search`, { waitUntil: "domcontentloaded" });
        }

        const zipInput = searchPage.locator(
          "input[placeholder*='Zip' i], input[placeholder*='ZIP' i], input[name*='zip' i]",
        ).first();

        if ((await zipInput.count().catch(() => 0)) > 0) {
          await zipInput.fill("77084", { timeout: 5_000 });
          const searchBtn = searchPage.locator(
            "button:has-text('Search'), button[type='submit']",
          ).first();
          if ((await searchBtn.count().catch(() => 0)) > 0) {
            await searchBtn.click({ timeout: 5_000 });
            await searchPage.waitForTimeout(3_000);
          }

          const rows = await searchPage
            .locator(
              "div[class*='__content'] div[class*='__item'], table tbody tr, [role='rowgroup'] [role='row'], [class*='result-row'], [class*='property-row']",
            )
            .count()
            .catch(() => 0);

          result.canPerformSearch = rows > 0;
        }
      } catch (err) {
        result.errors.push(`Search test failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── Store status after this track ────────────────────────────
    await store.load(); // reload to pick up captures from provider
    const allSnaps = await store.allSnapshots();
    const validCount = await store.validCount(config.sessionRefreshMarginMs);
    result.storeSnapshotsAfter = allSnaps.length;
    result.storeValidAfter = validCount;
  } catch (err) {
    result.errors.push(`${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (provider) {
      await provider.close().catch(() => undefined);
    }
  }

  return result;
}

export async function runBenchmark(config: RunnerConfig): Promise<TrackResult[]> {
  await ensureDir(config.runtimeRoot);
  await ensureDir(config.artifactsDir);

  const store = new CookieStore(config.cookieStorePath);
  await store.load();

  // Show initial store state
  const initialSnaps = await store.allSnapshots();
  const initialValid = await store.validCount(config.sessionRefreshMarginMs);
  console.log(`\nCookie Store: ${initialSnaps.length} snapshots, ${initialValid} valid`);
  if (initialValid < 2) {
    console.log(`WARNING: below minimum of 2 valid snapshots`);
  }

  const validations = await store.validateAll(config.sessionRefreshMarginMs);
  for (const v of validations) {
    console.log(
      `  [${v.valid ? "OK" : "!!"}] ${v.source.padEnd(18)} captured=${v.capturedAt.slice(0, 19)}  ` +
        `cookies=${v.cookieCount}  authToken=${v.authTokenPresent ? (v.authTokenExpired ? "EXPIRED" : "OK") : "MISSING"}` +
        (v.secondsUntilExpiry !== null ? `  ttl=${Math.floor(v.secondsUntilExpiry / 3600)}h` : ""),
    );
  }

  const tracks: TrackName[] = ["cdp", "persistent", "cookie-injection"];
  const results: TrackResult[] = [];

  for (const track of tracks) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`Benchmarking: ${track}`);
    console.log("─".repeat(70));

    const result = await benchmarkTrack(track, config, store);
    results.push(result);

    console.log(`  Auth:     ${result.authSucceeded ? "PASS" : "FAIL"} (${result.timeToAuthMs}ms)`);
    console.log(`  Restart:  ${result.survivesRestart ? "PASS" : "FAIL"}`);
    console.log(`  Search:   ${result.canPerformSearch ? "PASS" : "FAIL"}`);
    console.log(`  Cookies:  ${result.cookieCount} total | authToken=${result.hasAuthToken} | JSESSIONID=${result.hasJsessionId}`);
    console.log(`  Store:    ${result.storeSnapshotsAfter} snapshots, ${result.storeValidAfter} valid`);
    if (result.errors.length > 0) {
      console.log(`  Errors:   ${result.errors.join("; ")}`);
    }
  }

  // ── Summary table ──────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log("BENCHMARK SUMMARY");
  console.log("═".repeat(70));
  console.log(
    `${"Track".padEnd(20)} ${"Preflt".padEnd(8)} ${"Auth".padEnd(8)} ${"Restart".padEnd(10)} ${"Search".padEnd(10)} ${"Time(ms)".padEnd(10)} ${"Store".padEnd(8)}`,
  );
  console.log("─".repeat(70));
  for (const r of results) {
    console.log(
      `${r.track.padEnd(20)} ${(r.preflightValid ? "OK" : "FAIL").padEnd(8)} ${(r.authSucceeded ? "PASS" : "FAIL").padEnd(8)} ${(r.survivesRestart ? "PASS" : "FAIL").padEnd(10)} ${(r.canPerformSearch ? "PASS" : "FAIL").padEnd(10)} ${String(r.timeToAuthMs).padEnd(10)} ${r.storeValidAfter}/${r.storeSnapshotsAfter}`,
    );
  }
  console.log("═".repeat(70));

  // ── Final store health ─────────────────────────────────────────
  await store.load();
  const finalValid = await store.validCount(config.sessionRefreshMarginMs);
  const finalTotal = (await store.allSnapshots()).length;
  console.log(`\nFinal cookie store: ${finalTotal} snapshots, ${finalValid} valid`);
  if (finalValid >= 2) {
    console.log("Cookie store health: GOOD (2+ valid snapshots)");
  } else {
    console.log(`Cookie store health: DEGRADED (${finalValid}/2 minimum valid)`);
  }

  return results;
}
