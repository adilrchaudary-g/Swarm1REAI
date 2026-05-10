/**
 * Track C: Cookie Injection Session Provider
 *
 * Extracts cookies from Chrome's SQLite database, decrypts them,
 * and injects into a lightweight Playwright context. No 6.4 GB profile
 * copy — just a 1.8 MB SQLite read + fresh browser.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { RunnerConfig } from "../../config.js";
import type { SessionProvider } from "./types.js";
import { extractChromeCookies } from "../chrome-cookie-reader.js";
import { checkCookieHealth } from "../session-health.js";
import { CookieStore, type StoredCookie } from "../cookie-store.js";

/** Domains to extract cookies for. */
const PROPSTREAM_DOMAINS = [
  ".propstream.com",
  "app.propstream.com",
  "login.propstream.com",
  "resource.propstream.com",
  "signup.propstream.com",
];

export class CookieInjectionProvider implements SessionProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private store: CookieStore;

  constructor(private readonly config: RunnerConfig) {
    this.store = new CookieStore(config.cookieStorePath);
  }

  async start(options?: { headed?: boolean }): Promise<Page> {
    // Close any existing session
    if (this.browser) {
      await this.close();
    }

    // 0. Pre-flight: check cookie store for a valid snapshot first
    const preflight = await this.store.preflight(this.config.sessionRefreshMarginMs).catch(() => null);
    const storeCookies = preflight?.valid
      ? await this.store.getBestCookies(this.config.sessionRefreshMarginMs).catch(() => null)
      : null;

    // 1. Use store cookies if valid, otherwise extract from Chrome's DB
    const cookies = storeCookies
      ? storeCookies.cookies
      : await extractChromeCookies(
          this.config.chromeCookiesDbPath,
          PROPSTREAM_DOMAINS,
        );

    // 2. Launch a fresh chromium browser (no profile dir needed)
    this.browser = await chromium.launch({
      headless: options?.headed ? false : this.config.headless,
    });

    // 3. Create a new context
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 960 },
    });

    // 4. Inject the extracted cookies
    if (cookies.length > 0) {
      await this.context.addCookies(cookies);
    }

    // 5. Navigate to search page
    this.page = await this.context.newPage();
    await this.page.goto(this.config.baseUrl + "/search", {
      waitUntil: "domcontentloaded",
    }).catch((err) => {
      // ERR_ABORTED is expected when redirected to login
      if (!/ERR_ABORTED/i.test(String(err))) throw err;
    });

    // 6. Check authentication
    const health = await checkCookieHealth(this.context);

    // 7. If not authenticated, attempt credential login
    if (!health.isAuthenticated) {
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
    // Save storage state before closing (best-effort)
    if (this.context) {
      await this.saveStorageState(this.config.storageStatePath).catch(() => undefined);
    }

    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async getPage(): Promise<Page> {
    if (!this.page) {
      throw new Error("CookieInjectionProvider: no page — call start() first");
    }
    return this.page;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  async saveStorageState(path: string): Promise<void> {
    if (!this.context) return;
    await this.context.storageState({ path });
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.context) return false;
    const health = await checkCookieHealth(this.context);
    return health.isAuthenticated;
  }

  async refreshAuth(username: string, password: string): Promise<void> {
    if (!this.page || !this.context) {
      throw new Error("CookieInjectionProvider: no active session — call start() first");
    }

    // Navigate to base URL (will redirect to login if not authenticated)
    await this.page.goto(this.config.baseUrl, {
      waitUntil: "domcontentloaded",
    }).catch((err) => {
      if (!/ERR_ABORTED/i.test(String(err))) throw err;
    });

    // Wait briefly for any redirect to settle
    await this.page.waitForTimeout(1_000);

    // Dismiss cookie consent banner if present
    const allowAll = this.page.locator(
      '#accept-recommended-btn-handler, button:has-text("Allow All")',
    ).first();
    if (await allowAll.count().catch(() => 0)) {
      await allowAll.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    }

    // Detect and fill login form
    const usernameInput = this.page.locator(
      'input[name="username"], input[type="text"][placeholder*="Email" i], input[type="text"][placeholder*="Username" i]',
    ).first();
    const passwordInput = this.page.locator(
      'input[name="password"], input[type="password"]',
    ).first();

    // Wait for the login form to appear (up to 10s)
    await passwordInput.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);

    if (
      (await usernameInput.count().catch(() => 0)) &&
      (await passwordInput.count().catch(() => 0))
    ) {
      await usernameInput.fill(username, { timeout: 3_000 });
      await passwordInput.fill(password, { timeout: 3_000 });

      // Click submit
      const submitBtn = this.page.locator(
        'button[type="submit"], .gradient-btn',
      ).first();
      if (await submitBtn.count().catch(() => 0)) {
        await submitBtn.click({ force: true, timeout: 3_000 });
      }

      // Wait for redirect back to the app
      await this.page
        .waitForURL(/app\.propstream\.com/, { timeout: 15_000 })
        .catch(() => undefined);
    }

    // Save storage state after successful login + capture to store
    await this.saveStorageState(this.config.storageStatePath).catch(() => undefined);
    await this.captureToStore();
  }

  private async captureToStore(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies().catch(() => [] as StoredCookie[]);
    if (cookies.length > 0) {
      await this.store.capture(cookies as StoredCookie[], "cookie-injection").catch(() => undefined);
    }
  }
}
