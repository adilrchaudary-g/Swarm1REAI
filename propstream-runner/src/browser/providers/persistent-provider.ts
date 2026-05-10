import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { RunnerConfig } from "../../config.js";
import type { SessionProvider, SessionHealthReport } from "./types.js";
import {
  checkCookieHealth,
  checkPageHealth,
  shouldRefreshBeforeOperation,
} from "../session-health.js";
import { ensureDir } from "../../utils/fs.js";
import { CookieStore, type StoredCookie } from "../cookie-store.js";

export class PersistentSessionProvider implements SessionProvider {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private profileDir: string;
  private store: CookieStore;

  constructor(private readonly config: RunnerConfig) {
    this.profileDir = path.join(config.runtimeRoot, "persistent-profile");
    this.store = new CookieStore(config.cookieStorePath);
  }

  async start(options?: { headed?: boolean }): Promise<Page> {
    if (this.context && this.page) {
      return this.page;
    }

    // 1. Ensure runtime directories exist
    await ensureDir(this.config.runtimeRoot);
    await ensureDir(this.profileDir);

    // 2. Launch persistent context with a minimal dedicated profile dir
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] =
      {
        channel:
          this.config.browserChannel === "chrome" ? "chrome" : undefined,
        headless: options?.headed ? false : this.config.headless,
        acceptDownloads: true,
        viewport: { width: 1440, height: 960 },
      };

    if (
      this.config.browserChannel === "chrome" &&
      process.platform === "darwin" &&
      this.config.allowNativeKeychain
    ) {
      launchOptions.ignoreDefaultArgs = ["--use-mock-keychain"];
    }

    this.context = await chromium.launchPersistentContext(
      this.profileDir,
      launchOptions,
    );

    // 3. Seed cookies — try cookie store first, fall back to storage-state.json
    await this.seedCookies();

    // 4. Get or create a page from the context
    this.page = this.context.pages()[0] ?? (await this.context.newPage());

    // 5. Navigate to search page
    await this.page.goto(`${this.config.baseUrl}/search`, {
      waitUntil: "domcontentloaded",
    });

    // 6. Pre-flight: validate cookies before proceeding
    const preflight = await this.store.preflight(this.config.sessionRefreshMarginMs);

    // 7. Check session health — proactively refresh if needed
    const report = await checkCookieHealth(this.context);
    if (
      !preflight.valid ||
      shouldRefreshBeforeOperation(report, this.config.sessionRefreshMarginMs)
    ) {
      const username = this.config.propstreamUsername;
      const password = this.config.propstreamPassword;
      if (username && password) {
        await this.refreshAuth(username, password);
      }
    }

    // 8. Capture cookies to store
    await this.captureToStore();

    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.saveStorageState(this.config.storageStatePath).catch(
        () => undefined,
      );
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.page = null;
  }

  async getPage(): Promise<Page> {
    if (!this.page || !this.context) {
      throw new Error(
        "PersistentSessionProvider not started — call start() first",
      );
    }

    // Quick health check before returning
    const report = await checkCookieHealth(this.context);
    if (
      shouldRefreshBeforeOperation(report, this.config.sessionRefreshMarginMs)
    ) {
      const username = this.config.propstreamUsername;
      const password = this.config.propstreamPassword;
      if (username && password) {
        await this.refreshAuth(username, password);
      }
    }

    return this.page;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  async saveStorageState(savePath: string): Promise<void> {
    if (!this.context) return;
    await this.context.storageState({ path: savePath });
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.context || !this.page) return false;

    const cookieReport = await checkCookieHealth(this.context);
    if (!cookieReport.isAuthenticated) return false;

    const pageReport = await checkPageHealth(this.page);
    if (pageReport.authRequired) return false;

    return true;
  }

  async refreshAuth(username: string, password: string): Promise<void> {
    if (!this.context || !this.page) {
      throw new Error(
        "PersistentSessionProvider not started — call start() first",
      );
    }

    // 1. Navigate to base URL (redirects to login if not authenticated)
    await this.page.goto(this.config.baseUrl, {
      waitUntil: "domcontentloaded",
    });

    // 2. Wait for either the search page (already authed) or login form
    await Promise.race([
      this.page.waitForURL(/\/search/, { timeout: 10_000 }),
      this.page
        .waitForSelector('input[type="password"]', { timeout: 10_000 })
        .catch(() => null),
    ]).catch(() => undefined);

    // 3. If login form is present, fill credentials
    const passwordInput = this.page
      .locator('input[name="password"], input[type="password"]')
      .first();
    const hasPasswordField = (await passwordInput.count().catch(() => 0)) > 0;

    if (hasPasswordField) {
      // Dismiss cookie consent if present
      const allowAll = this.page
        .locator(
          '#accept-recommended-btn-handler, button:has-text("Allow All")',
        )
        .first();
      if ((await allowAll.count().catch(() => 0)) > 0) {
        await allowAll
          .click({ force: true, timeout: 2_000 })
          .catch(() => undefined);
      }

      // Fill username
      const usernameInput = this.page
        .locator(
          'input[name="username"], input[type="text"][placeholder*="Email" i]',
        )
        .first();
      await usernameInput
        .fill(username, { timeout: 3_000 })
        .catch(() => undefined);

      // Fill password
      await passwordInput
        .fill(password, { timeout: 3_000 })
        .catch(() => undefined);

      // Submit
      const submit = this.page
        .locator('button[type="submit"], .gradient-btn')
        .first();
      if ((await submit.count().catch(() => 0)) > 0) {
        await submit
          .click({ force: true, timeout: 3_000 })
          .catch(() => undefined);
      }

      // Wait for redirect
      await this.page.waitForTimeout(3_000);
    }

    // 4. Verify we landed on the search page
    if (!/\/search/i.test(this.page.url())) {
      await this.page
        .goto(`${this.config.baseUrl}/search`, {
          waitUntil: "domcontentloaded",
        })
        .catch(() => undefined);
    }

    // 5. Save storage state + capture to store
    await this.saveStorageState(this.config.storageStatePath);
    await this.captureToStore();
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async captureToStore(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies().catch(() => [] as StoredCookie[]);
    if (cookies.length > 0) {
      await this.store.capture(cookies as StoredCookie[], "persistent").catch(() => undefined);
    }
  }

  private async seedCookies(): Promise<void> {
    if (!this.context) return;

    // Try cookie store first (may have fresher cookies from other tracks)
    const best = await this.store.getBestCookies(this.config.sessionRefreshMarginMs).catch(() => null);
    if (best && best.cookies.length > 0) {
      const persistent = best.cookies.filter((c) => c.expires > 0);
      if (persistent.length > 0) {
        await this.context.addCookies(persistent);
        return;
      }
    }

    // Fall back to storage-state.json
    await this.seedCookiesFromStorageState();
  }

  private async seedCookiesFromStorageState(): Promise<void> {
    if (!this.context) return;

    try {
      const raw = await readFile(this.config.storageStatePath, "utf8");
      const state = JSON.parse(raw) as {
        cookies?: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
          sameSite: "Strict" | "Lax" | "None";
        }>;
      };

      if (!state.cookies || state.cookies.length === 0) return;

      // Filter to only persistent cookies (skip session cookies with expires <= 0)
      const persistentCookies = state.cookies.filter((c) => c.expires > 0);
      if (persistentCookies.length === 0) return;

      await this.context.addCookies(persistentCookies);
    } catch {
      // storage-state.json doesn't exist or is invalid — that's fine on first run
    }
  }
}
