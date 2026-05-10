import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { RunnerConfig } from "../../config.js";
import type { SessionProvider } from "./types.js";
import { checkCookieHealth } from "../session-health.js";
import { ensureChromeRunning } from "../chrome-launcher.js";
import { CookieStore, type StoredCookie } from "../cookie-store.js";

/**
 * Track A: CDP Connection to Running Chrome.
 *
 * Keeps a long-lived Chrome instance alive with `--remote-debugging-port`.
 * Playwright connects via `chromium.connectOverCDP()`. Chrome never dies
 * between Node process restarts, so session cookies (JSESSIONID with
 * `expires=-1`) survive naturally.
 */
export class CdpSessionProvider implements SessionProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private store: CookieStore;

  constructor(private readonly config: RunnerConfig) {
    this.store = new CookieStore(config.cookieStorePath);
  }

  async start(_options?: { headed?: boolean }): Promise<Page> {
    // 1. Ensure Chrome is up with CDP enabled.
    if (this.config.cdpAutoLaunch) {
      await ensureChromeRunning({
        port: this.config.cdpPort,
        userDataDir: this.config.chromeUserDataDir,
        headless: this.config.headless,
      });
    }

    // 2. Connect via CDP.
    this.browser = await chromium.connectOverCDP(
      `http://localhost:${this.config.cdpPort}`,
    );

    // 3. Grab the default browser context (carries real cookies).
    const contexts = this.browser.contexts();
    if (contexts.length === 0) {
      throw new Error(
        "CDP connection returned zero browser contexts — the default context should always exist",
      );
    }
    this.context = contexts[0];

    // 4. Reuse an existing PropStream tab if one is open.
    const existingPage = this.context.pages().find((p) => {
      try {
        return /propstream\.com/i.test(p.url());
      } catch {
        return false;
      }
    });

    if (existingPage) {
      this.page = existingPage;
    } else {
      // 5. No PropStream tab — open one.
      this.page = await this.context.newPage();
      await this.page.goto(`${this.config.baseUrl}/search`, {
        waitUntil: "domcontentloaded",
      });
    }

    // 6. Capture cookies to store after successful connection.
    await this.captureToStore();

    return this.page;
  }

  /**
   * Disconnect from Chrome but do NOT kill Chrome itself.
   * The browser process keeps running so session cookies survive.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /**
   * Return the current page, reconnecting if the previous connection dropped.
   */
  async getPage(): Promise<Page> {
    if (this.page) {
      // Verify the page is still usable.
      try {
        // A lightweight check — if the connection is dead this will throw.
        this.page.url();
        return this.page;
      } catch {
        // Connection dropped — fall through to reconnect.
      }
    }
    return this.start();
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  async saveStorageState(path: string): Promise<void> {
    if (!this.context) {
      throw new Error("Cannot save storage state — no active browser context");
    }
    await this.context.storageState({ path });
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.context) return false;
    const report = await checkCookieHealth(this.context);
    return report.isAuthenticated;
  }

  /**
   * Navigate to the PropStream login page, fill credentials, and wait for
   * the post-login redirect.
   */
  async refreshAuth(username: string, password: string): Promise<void> {
    const page = await this.getPage();

    // Navigate to login — PropStream redirects unauthenticated users here.
    await page.goto(`${this.config.baseUrl}/search`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the password input to appear (indicates login form is loaded).
    const passwordInput = page.locator(
      'input[name="password"], input[type="password"]',
    ).first();
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });

    // Fill username.
    const usernameInput = page.locator(
      'input[name="username"], input[type="text"][placeholder*="Email" i], input[type="text"][placeholder*="Username" i]',
    ).first();
    await usernameInput.fill(username, { timeout: 5_000 });

    // Fill password.
    await passwordInput.fill(password, { timeout: 5_000 });

    // Submit.
    const submit = page.locator(
      'button[type="submit"], .gradient-btn',
    ).first();
    await submit.click({ force: true, timeout: 5_000 });

    // Wait for redirect / navigation after login.
    await page.waitForTimeout(2_000);

    // Capture fresh cookies after successful auth.
    await this.captureToStore();
  }

  private async captureToStore(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies().catch(() => [] as StoredCookie[]);
    if (cookies.length > 0) {
      await this.store.capture(cookies as StoredCookie[], "cdp").catch(() => undefined);
    }
  }
}
