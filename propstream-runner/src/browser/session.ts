import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Download, type Page } from "playwright";
import { PAGE_BRIDGE_SOURCE } from "../pageBridge.js";
import type { RunnerConfig } from "../config.js";
import { BridgeError } from "../quota.js";
import { PageStateSchema, type PageState } from "../supervisor/schema.js";
import { ensureDir } from "../utils/fs.js";
import type { SessionProvider } from "./providers/types.js";
import { CdpSessionProvider } from "./providers/cdp-provider.js";
import { PersistentSessionProvider } from "./providers/persistent-provider.js";
import { CookieInjectionProvider } from "./providers/cookie-injection-provider.js";
import { CookieStore, type StoredCookie } from "./cookie-store.js";

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionMode: "storage-state" | "persistent" | "provider" | null = null;
  private provider: SessionProvider | null = null;
  private store: CookieStore;

  constructor(private readonly config: RunnerConfig) {
    this.store = new CookieStore(config.cookieStorePath);
  }

  async start(options?: { headed?: boolean }) {
    if (this.context && this.page) {
      if (options?.headed && this.sessionMode !== "persistent" && this.sessionMode !== "provider") {
        await this.close();
      } else {
      return this.page;
      }
    }

    await ensureDir(this.config.runtimeRoot);
    await ensureDir(this.config.downloadsDir);
    await ensureDir(this.config.artifactsDir);

    const strategy = this.config.sessionStrategy;

    if (strategy !== "auto") {
      return this.startWithProvider(strategy, options);
    }

    // ── "auto" mode: original code path ��─────────────────────────

    const shouldUseStorageState =
      !options?.headed && this.config.headless && (await this.hasStorageState());

    if (shouldUseStorageState) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });
      this.context = await this.browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 960 },
        storageState: this.config.storageStatePath,
      });
      await this.context.addInitScript({ content: PAGE_BRIDGE_SOURCE });
      this.page = await this.context.newPage();
      this.sessionMode = "storage-state";
      await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await this.ensureBridgeInjected(this.page);
      return this.page;
    }

    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      channel: this.config.browserChannel === "chrome" ? "chrome" : undefined,
      headless: options?.headed ? false : this.config.headless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 960 },
    };
    if (this.config.browserChannel === "chrome" && this.config.allowNativeKeychain) {
      launchOptions.ignoreDefaultArgs = ["--use-mock-keychain"];
    }

    this.context = await chromium.launchPersistentContext(this.config.userDataDir, launchOptions);
    await this.context.addInitScript({ content: PAGE_BRIDGE_SOURCE });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.sessionMode = "persistent";
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await this.ensureBridgeInjected(this.page);
    return this.page;
  }

  private async startWithProvider(
    strategy: "cdp" | "persistent" | "cookie-injection",
    options?: { headed?: boolean },
  ) {
    if (!this.provider) {
      switch (strategy) {
        case "cdp":
          this.provider = new CdpSessionProvider(this.config);
          break;
        case "persistent":
          this.provider = new PersistentSessionProvider(this.config);
          break;
        case "cookie-injection":
          this.provider = new CookieInjectionProvider(this.config);
          break;
      }
    }

    this.page = await this.provider.start(options);
    this.context = this.provider.getContext();
    this.sessionMode = "provider";

    // Inject bridge — addInitScript may not work (CDP), so use addScriptTag
    await this.ensureBridgeInjected(this.page);

    return this.page;
  }

  private async ensureBridgeInjected(page: Page, force = false) {
    const bridgePresent =
      !force &&
      (await page
        .evaluate(() => Boolean((window as typeof window & { __PS_RUNNER__?: unknown }).__PS_RUNNER__))
        .catch(() => false));
    if (bridgePresent) return;
    await page.addScriptTag({ content: PAGE_BRIDGE_SOURCE }).catch(() => undefined);
  }

  async refreshBridge() {
    const page = await this.getPage();
    await this.ensureBridgeInjected(page, true);
  }

  private async hasStorageState() {
    try {
      await access(this.config.storageStatePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async ensureStarted() {
    if (!this.context || !this.page) {
      await this.start();
    }
    return this.page as Page;
  }

  async bootstrapAuth() {
    const page = await this.start({ headed: true });
    const currentUrl = page.url();
    if (!/propstream\.com\/search/i.test(currentUrl)) {
      await page.goto(`${this.config.baseUrl}/search`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch((error) => {
        if (!/ERR_ABORTED/i.test(String(error))) {
          throw error;
        }
      });
    }
    await page.bringToFront();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5 * 60_000) {
      await this.attemptCredentialLogin(page).catch(() => undefined);
      const quickState = await page
        .evaluate(() => ({
          href: window.location.href,
          route: window.location.pathname,
          title: document.title || "",
          hasPassword: Boolean(document.querySelector("input[type='password']")),
          hasCaptcha: Boolean(document.querySelector("iframe[src*='recaptcha'], [class*='captcha'], [id*='captcha']")),
        }))
        .catch(() => null);
      if (
        quickState &&
        /app\.propstream\.com/i.test(quickState.href) &&
        /\/search/i.test(quickState.route) &&
        !quickState.hasPassword &&
        !quickState.hasCaptcha &&
        !/login|sign[\s-]?in/i.test(quickState.title)
      ) {
        await this.saveStorageState();
        return this.snapshot().catch(() => ({
          route: quickState.route,
          title: quickState.title,
          page_phase: "search",
          visible_regions: [],
          candidate_actions: [],
          result_count_text: null,
          visible_row_count: 0,
          selected_list_name: null,
          selected_zip: null,
          has_captcha: false,
          auth_required: false,
          diagnostics: {
            quick_auth_gate: true,
            href: quickState.href,
          },
        }));
      }
      const state = await this.snapshot().catch(() => null);
      if (!state) {
        await page.waitForTimeout(1_000);
        continue;
      }
      const currentHref = page.url();
      const looksAuthenticated =
        !state.has_captcha &&
        (!state.auth_required ||
          (/app\.propstream\.com/i.test(currentHref) && /\/search/i.test(state.route)));
      if (looksAuthenticated) {
        await this.saveStorageState();
        return state;
      }
      await page.waitForTimeout(1_000);
    }
    await this.screenshot("bootstrap-auth-timeout").catch(() => undefined);
    throw new BridgeError("AUTH_REQUIRED", "Timed out waiting for manual PropStream login");
  }

  async waitForManualSearchReady() {
    const page = await this.start({ headed: true });
    const currentUrl = page.url();
    if (!/propstream\.com\/search/i.test(currentUrl)) {
      await page.goto(`${this.config.baseUrl}/search`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch((error) => {
        if (!/ERR_ABORTED/i.test(String(error))) {
          throw error;
        }
      });
    }
    await page.bringToFront();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5 * 60_000) {
      await this.attemptCredentialLogin(page).catch(() => undefined);
      const quickState = await page
        .evaluate(() => ({
          href: window.location.href,
          route: window.location.pathname,
          title: document.title || "",
          hasPassword: Boolean(document.querySelector("input[type='password']")),
          hasCaptcha: Boolean(document.querySelector("iframe[src*='recaptcha'], [class*='captcha'], [id*='captcha']")),
        }))
        .catch(() => null);
      if (
        quickState &&
        /app\.propstream\.com/i.test(quickState.href) &&
        /\/search/i.test(quickState.route) &&
        !quickState.hasPassword &&
        !quickState.hasCaptcha &&
        !/login|sign[\s-]?in/i.test(quickState.title)
      ) {
        await this.saveStorageState().catch(() => undefined);
        return quickState;
      }
      await page.waitForTimeout(1_000);
    }
    await this.screenshot("manual-search-timeout").catch(() => undefined);
    throw new BridgeError("AUTH_REQUIRED", "Timed out waiting for manual authenticated search page");
  }

  private async attemptCredentialLogin(page: Page) {
    if (!this.config.propstreamUsername || !this.config.propstreamPassword) return false;
    const href = page.url();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const usernameInput = page.locator('input[name="username"], input[type="text"][placeholder*="Email" i], input[type="text"][placeholder*="Username" i]').first();
    if (!/login\.propstream\.com/i.test(href) && !(await passwordInput.count().catch(() => 0))) {
      return false;
    }

    const allowAll = page.locator('#accept-recommended-btn-handler, button:has-text("Allow All")').first();
    if (await allowAll.count().catch(() => 0)) {
      await allowAll.click({ force: true, timeout: 1_000 }).catch(() => undefined);
    }

    if ((await usernameInput.count().catch(() => 0)) && (await passwordInput.count().catch(() => 0))) {
      await usernameInput.fill(this.config.propstreamUsername, { timeout: 2_000 }).catch(() => undefined);
      await passwordInput.fill(this.config.propstreamPassword, { timeout: 2_000 }).catch(() => undefined);
      const submit = page.locator('button[type="submit"], .gradient-btn').first();
      if (await submit.count().catch(() => 0)) {
        await submit.click({ force: true, timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(2_000);
        return true;
      }
    }
    return false;
  }

  async attemptCredentialLoginOnCurrentPage() {
    const page = await this.getPage();
    return this.attemptCredentialLogin(page);
  }

  async saveStorageState() {
    if (this.provider) {
      await this.provider.saveStorageState(this.config.storageStatePath);
    } else if (this.context) {
      await this.context.storageState({ path: this.config.storageStatePath });
    } else {
      return;
    }
    // Capture to cookie store for cross-track redundancy
    await this.captureToStore();
  }

  private async captureToStore(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies().catch(() => [] as StoredCookie[]);
    if (cookies.length > 0) {
      const source = this.sessionMode === "provider" ? "auto" : this.sessionMode ?? "auto";
      await this.store
        .capture(cookies as StoredCookie[], source as "auto" | "bootstrap")
        .catch(() => undefined);
    }
  }

  async getPage() {
    return this.ensureStarted();
  }

  async snapshot(): Promise<PageState> {
    const page = await this.getPage();
    let raw = await page.evaluate(() => {
      return (window as typeof window & {
        __PS_RUNNER__?: { snapshot: () => unknown };
      }).__PS_RUNNER__?.snapshot();
    });
    if (!raw) {
      await this.ensureBridgeInjected(page);
      raw = await page.evaluate(() => {
        return (window as typeof window & {
          __PS_RUNNER__?: { snapshot: () => unknown };
        }).__PS_RUNNER__?.snapshot();
      });
    }
    if (!raw) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      raw = await page.evaluate(`
        (() => {
          const text = (node) => ((node?.textContent || "").replace(/\\s+/g, " ").trim());
          const isVisible = (node) => {
            if (!node) return false;
            const style = window.getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const pagePhase = () => {
            const pathname = window.location.pathname;
            if (/account|billing|usage/i.test(pathname)) return "usage";
            if (/property\\/group/i.test(pathname)) return "saved_list";
            if (/search\\//i.test(pathname) && pathname !== "/search") return "property_detail";
            if (/search/i.test(pathname)) return "search";
            return "unknown";
          };
          const visibleRegions = Array.from(document.querySelectorAll("main, section, aside, [role='dialog']"))
            .filter((node) => isVisible(node))
            .map((node) => {
              const label = node.getAttribute("aria-label") || node.getAttribute("role") || node.tagName.toLowerCase();
              const snippet = text(node).slice(0, 80);
              return [label, snippet].filter(Boolean).join(": ");
            })
            .slice(0, 20);
          const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"))
            .filter((node) => isVisible(node))
            .map((node) => text(node).slice(0, 120) || (node.href || ""))
            .filter(Boolean)
            .slice(0, 40);
          const rows = Array.from(
            document.querySelectorAll(
              "div[class*='__content'] div[class*='__item'], table tbody tr, [role='rowgroup'] [role='row'], [class*='result-row'], [class*='property-row']"
            )
          ).filter((node) => isVisible(node));
          const countCandidate = Array.from(document.querySelectorAll("[class*='caption'], h1, h2, h3")).find((node) =>
            /properties|results/i.test(text(node))
          );
          const selectedZipInput = document.querySelector(
            "input[placeholder*='Zip' i], input[placeholder*='ZIP' i], input[name*='zip' i]"
          );
          const selectedListNode = Array.from(document.querySelectorAll("h1, h2, h3, [class*='title']")).find((node) =>
            /saved|list|properties/i.test(text(node))
          );
          const route = window.location.pathname;
          const bodyText = document.body?.innerText?.slice(0, 1500) || "";
          const authRequired =
            Boolean(document.querySelector("input[type='password']")) ||
            /login|sign[\\s-]?in/i.test(document.title || "") ||
            (!/\\/search/i.test(route) &&
              /username|email address/i.test(bodyText) &&
              /password/i.test(bodyText) &&
              /login|sign in|log in/i.test(bodyText));
          return {
            route,
            title: document.title || "",
            page_phase: pagePhase(),
            visible_regions: visibleRegions,
            candidate_actions: buttons,
            result_count_text: countCandidate ? text(countCandidate) : null,
            visible_row_count: rows.length,
            selected_list_name: selectedListNode ? text(selectedListNode) : null,
            selected_zip: selectedZipInput ? String(selectedZipInput.value || "") : null,
            has_captcha: Boolean(document.querySelector("iframe[src*='recaptcha'], [class*='captcha'], [id*='captcha']")),
            auth_required: authRequired,
            diagnostics: {
              route_query: window.location.search,
              body_preview: bodyText.slice(0, 300),
            },
          };
        })()
      `);
    }
    return PageStateSchema.parse(raw);
  }

  async refreshPage() {
    const page = await this.getPage();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  }

  async gotoSearchPage() {
    const page = await this.getPage();
    await page.goto(`${this.config.baseUrl}/search`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }

  async gotoSavedListPage() {
    const page = await this.getPage();
    await page.goto(`${this.config.baseUrl}/property/group/0`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }

  async gotoUsagePage() {
    const page = await this.getPage();
    await page.goto(`${this.config.baseUrl}/accountnew/landing`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }

  async screenshot(label: string) {
    const page = await this.getPage();
    const filePath = path.join(this.config.artifactsDir, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async captureTrace(label: string) {
    if (!this.context) return null;
    const tracePath = path.join(this.config.artifactsDir, `${Date.now()}-${label}.zip`);
    await this.context.tracing.stop({ path: tracePath }).catch(() => undefined);
    await this.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
    return tracePath;
  }

  async armTracing() {
    if (!this.context) return;
    await this.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
  }

  async waitForDownload(timeoutMs = 30_000): Promise<Download> {
    const page = await this.getPage();
    return page.waitForEvent("download", { timeout: timeoutMs });
  }

  getCookieStore(): CookieStore {
    return this.store;
  }

  executionMode(): "headless" | "headed" {
    return this.config.headless ? "headless" : "headed";
  }

  async close() {
    if (this.provider) {
      await this.provider.close();
      this.provider = null;
      this.browser = null;
      this.context = null;
      this.page = null;
      this.sessionMode = null;
      return;
    }
    await this.browser?.close().catch(() => undefined);
    if (!this.browser) {
      await this.context?.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.sessionMode = null;
  }
}
