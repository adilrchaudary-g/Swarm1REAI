import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Download, Page } from "playwright";
import type { RunnerConfig } from "../config.js";
import { parseCsv } from "../csv.js";
import { mapExportRows } from "../exportMapping.js";
import { BridgeError, type QuotaManager } from "../quota.js";
import type { PageState } from "../supervisor/schema.js";
import type {
  CommandPayload,
  ExportPayload,
  QuotaSnapshot,
  ResultPayload,
  SavePayload,
  SearchPayload,
  SkipTracePayload,
} from "../types.js";
import { BrowserSession } from "../browser/session.js";

const SELECTORS = {
  sessionExpiredIndicators: [
    '[data-testid*="login"]',
    'form[action*="login"]',
    'input[type="password"]',
    "a[href*='login']",
  ],
  captchaIndicators: ['iframe[src*="recaptcha"]', '[class*="captcha"]', '[id*="captcha"]'],
  searchZipInputs: [
    '.react-autosuggest__container input',
    'input[aria-controls^="react-autowhatever"]',
    'div[class*="searchInput"] input',
    'input[placeholder*="Zip" i]',
    'input[placeholder*="ZIP" i]',
    'input[name*="zip" i]',
    'input[placeholder*="County" i]',
    'input[type="text"]',
  ],
  filterButtons: ['button[class*="dropdownToggleBtn"]', 'button[class*="filter"]'],
  applyButtons: [
    'div[class*="iconSearch"]',
    'button[type="submit"]',
    'button[class*="apply"]',
    'button[class*="search"]',
    '[class*="searchText"]',
  ],
  resultsPanel: [
    'div[class*="Search-Results-style"]',
    'div[class*="__resultsHeader"]',
  ],
  resultRows: [
    'div[class*="Search-Results-style"] div[class*="__content"] div[class*="__item"]',
    'div[class*="Search-Results-style"] .ag-row',
    '.ag-center-cols-container .ag-row',
    '.ag-body-viewport .ag-row',
  ],
  saveButtons: ['button[class*="save"]', 'button[class*="imageIconButton"]'],
  listInputs: ['input[placeholder*="list" i]', '[role="dialog"] input', '[class*="AddToMarketingListModal"] input', '[class*="modalBox"] input'],
  listOptions: ['[role="option"]', "[role='dialog'] li", '[class*="ListManagementField"] li', '[class*="AddToMarketingListModal"] li'],
  saveModals: [
    '[class*="AddToMarketingListModal"]',
    '[class*="modalOverlay"]',
    '[class*="modalBox"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
  ],
  exportButtons: ['button[class*="export"]', 'button:has-text("Export")'],
  skipTraceButtons: ['button[class*="skipTraceBtn"]', 'button[class*="skip"]'],
  skipTraceModals: [
    '[class*="SkipTraceModal"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
  ],
  usageCounterRegions: ['[class*="usage"]', '[class*="quota"]', "main"],
};

type BridgeMethod =
  | "openActionsMenu"
  | "openBulkActionByText"
  | "setBulkSelection"
  | "setInputRange"
  | "showPropertyRange"
  | "selectResultRowsByRange"
  | "clickSearchHeaderSave";

type AcquisitionResult = {
  status: ResultPayload["status"];
  items: Array<Record<string, unknown>>;
  errors: ResultPayload["errors"];
};

export class PropStreamClient {
  private lastSuccessfulStep = "startup";
  private _lastExportCsv: string | null = null;

  get lastExportCsv() { return this._lastExportCsv; }

  constructor(
    private readonly browser: BrowserSession,
    private readonly config: RunnerConfig,
    private readonly quota: QuotaManager,
  ) {}

  getLastSuccessfulStep() {
    return this.lastSuccessfulStep;
  }

  private logStep(step: string, extra?: Record<string, unknown>) {
    this.lastSuccessfulStep = step;
    const payload = extra ? ` ${JSON.stringify(extra)}` : "";
    console.error(`[propstream] ${step}${payload}`);
  }

  async currentPageState(): Promise<PageState> {
    return this.browser.snapshot();
  }

  async ensureReady() {
    this.logStep("ensure-ready:start");
    const page = await this.browser.getPage();
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    let state = await this.browser.snapshot();
    if (state.has_captcha) {
      throw new BridgeError("CAPTCHA_REQUIRED", "Captcha detected");
    }
    if (state.auth_required) {
      this.logStep("ensure-ready:auth-expired-attempting-login");
      const loggedIn = await this.browser.attemptCredentialLoginOnCurrentPage().catch(() => false);
      if (loggedIn) {
        await page.waitForTimeout(5_000);
        state = await this.browser.snapshot();
      }
      if (state.auth_required) {
        throw new BridgeError("AUTH_REQUIRED", "Session requires authentication");
      }
    }
    this.logStep("ensure-ready:ok", { route: state.route, title: state.title });
    return state;
  }

  async openSearch() {
    const page = await this.browser.getPage();
    const state = await this.browser.snapshot();
    this.logStep("open-search:state", { route: state.route });
    if (!state.route.startsWith("/search")) {
      await this.browser.gotoSearchPage();
    }
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    const href = page.url();
    const hasPasswordField = await page.locator('input[type="password"]').count().catch(() => 0);
    if (/login\.propstream\.com/i.test(href) || hasPasswordField > 0) {
      this.logStep("open-search:auth-required", { href, hasPasswordField });
      const loggedIn = await this.browser.attemptCredentialLoginOnCurrentPage().catch(() => false);
      if (!loggedIn) {
        throw new BridgeError("AUTH_REQUIRED", `Session expired during openSearch (url: ${href})`);
      }
      await this.browser.gotoSearchPage();
      await this.dismissBlockingOverlays(page).catch(() => undefined);
    }
    this.logStep("open-search:ok", { href: page.url() });
    return page;
  }

  private async dismissBlockingOverlays(page: Page) {
    // PropStream session warning dialog: click "Proceed" to dismiss
    const proceedBtn = page.locator('button:has-text("Proceed")').first();
    if (await proceedBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await proceedBtn.click({ force: true, timeout: 2_000 }).catch(() => undefined);
      this.logStep("dismiss-overlay:proceed-clicked");
      await page.waitForTimeout(2_000);
    }

    // PropStream "Updates" alert: check "do not show" then click Close via Playwright
    const alertCheckbox = page
      .locator('[class*="Alert-style"] input[type="checkbox"]')
      .first();
    if (await alertCheckbox.count().catch(() => 0)) {
      const checked = await alertCheckbox.isChecked().catch(() => true);
      if (!checked) {
        await alertCheckbox.check({ force: true, timeout: 2_000 }).catch(() => undefined);
      }
    }
    const alertClose = page
      .locator('[class*="Alert-style"] button')
      .filter({ hasText: /^close$/i })
      .first();
    if (await alertClose.isVisible().catch(() => false)) {
      await alertClose.click({ force: true, timeout: 2_000 }).catch(() => undefined);
      this.logStep("dismiss-overlay:alert-closed");
      await page.waitForTimeout(1_000);
    }

    await page
      .evaluate(() => {
        const visible = (node: Element | null | undefined) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const modalRoots = Array.from(
          document.querySelectorAll('[class*="modal"], [role="dialog"], #alert, [class*="Alert-style"]'),
        ).filter(
          (node) =>
            visible(node) &&
            /propstream updates|add to your calendar|do not show this message again/i.test(
              (node.textContent || "").replace(/\s+/g, " "),
            ),
        );

        for (const modal of modalRoots) {
          const checkboxLabel = Array.from(modal.querySelectorAll("label, span, div")).find((node) =>
            /do not show this message again/i.test((node.textContent || "").replace(/\s+/g, " ")),
          );
          const checkbox =
            checkboxLabel?.querySelector('input[type="checkbox"]') ||
            checkboxLabel?.closest("label")?.querySelector('input[type="checkbox"]');
          if (checkbox instanceof HTMLInputElement && !checkbox.checked) {
            checkbox.click();
          }

          const closeButton = Array.from(modal.querySelectorAll("button, [role='button'], span, div")).find((node) =>
            /^close$/i.test((node.textContent || "").replace(/\s+/g, " ").trim()),
          );
          if (closeButton instanceof HTMLElement) {
            closeButton.click();
          }

          if (visible(modal)) {
            (modal as HTMLElement).style.display = "none";
            (modal as HTMLElement).setAttribute("aria-hidden", "true");
          }
        }

        for (const overlay of Array.from(document.querySelectorAll(".fade, [class*='overlay'], [class*='backdrop']"))) {
          const text = (overlay.textContent || "").replace(/\s+/g, " ");
          if (!text || /propstream updates|add to your calendar/i.test(text) || visible(overlay)) {
            (overlay as HTMLElement).style.display = "none";
            (overlay as HTMLElement).style.pointerEvents = "none";
          }
        }

        document.body.classList.remove("bodyModal");
        document.body.style.overflow = "auto";
        document.body.style.pointerEvents = "auto";
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);

    const chatOverlayClose = page.locator('[class*="chatContainer"] [class*="closeBtn"]').first();
    if (await chatOverlayClose.count()) {
      await chatOverlayClose.click({ force: true, timeout: 1_000 }).catch(() => undefined);
    }
  }

  private async waitForVisibleRows(page: Page, timeoutMs = 15_000) {
    const started = Date.now();
    let panelFound = false;
    while (Date.now() - started < timeoutMs) {
      if (!panelFound) {
        for (const selector of SELECTORS.resultsPanel) {
          if (await page.locator(selector).first().isVisible().catch(() => false)) {
            panelFound = true;
            this.logStep("wait-rows:results-panel-found", { selector });
            break;
          }
        }
      }
      const rows = await page.locator(SELECTORS.resultRows.join(", ")).all();
      const visible = [];
      for (const row of rows) {
        if (await row.isVisible().catch(() => false)) visible.push(row);
      }
      if (visible.length) return visible;
      const href = page.url();
      if (/login\.propstream\.com/i.test(href)) {
        throw new BridgeError("AUTH_REQUIRED", "Redirected to login during search");
      }
      await page.waitForTimeout(250);
    }
    const href = page.url();
    const title = await page.title().catch(() => "");
    const bodyPreview = await page
      .locator("body")
      .innerText()
      .then((text) => text.replace(/\s+/g, " ").slice(0, 1200))
      .catch(() => "");
    const candidateCounts = await Promise.all(
      [
        ["resultsPanel", SELECTORS.resultsPanel.join(", ")],
        ["resultRows", SELECTORS.resultRows.join(", ")],
        ["agRows", ".ag-row"],
        ["searchResultsItems", 'div[class*="Search-Results-style"] div[class*="__item"]'],
        ["tables", "table, [role='table'], [role='grid']"],
        ["passwordInputs", 'input[type="password"]'],
      ].map(async ([name, selector]) => ({
        name,
        selector,
        count: await page.locator(selector).count().catch(() => -1),
      })),
    );
    const htmlPath = path.join(this.config.artifactsDir, `${Date.now()}-rows-debug.html`);
    const screenshotPath = await this.browser.screenshot("rows-debug").catch(() => null);
    const content = await page.content().catch(() => "");
    if (content) {
      await writeFile(htmlPath, content, "utf8").catch(() => undefined);
    }
    const diagnostics = {
      href,
      title,
      panelFound,
      bodyPreview,
      candidateCounts,
      screenshotPath,
      htmlPath: content ? htmlPath : null,
    };
    throw new BridgeError(
      "DOM_SELECTOR_MISSING",
      `Result rows did not appear :: ${JSON.stringify(diagnostics)}`,
    );
  }

  private async setInputValue(page: Page, selectors: string[], value: string) {
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count()) {
          try {
            await locator.click({ timeout: 2_000 }).catch(() => undefined);
            await locator.fill(value, { timeout: 5_000 });
            await locator.dispatchEvent("input", undefined, { timeout: 2_000 }).catch(() => undefined);
            await locator.dispatchEvent("change", undefined, { timeout: 2_000 }).catch(() => undefined);
            return;
          } catch {
            continue;
          }
        }
      }
      await page.waitForTimeout(250);
    }
    const diagnostics = await page
      .evaluate(() => {
        const visible = (node: Element | null | undefined) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const summarize = (node: Element) => ({
          tag: node.tagName.toLowerCase(),
          type: (node as HTMLInputElement).type || null,
          id: node.id || null,
          name: node.getAttribute("name"),
          placeholder: node.getAttribute("placeholder"),
          ariaLabel: node.getAttribute("aria-label"),
          role: node.getAttribute("role"),
          className: typeof node.className === "string" ? node.className.slice(0, 160) : null,
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        });
        return {
          href: window.location.href,
          title: document.title || "",
          visibleInputs: Array.from(document.querySelectorAll("input, textarea"))
            .filter((node) => visible(node))
            .slice(0, 20)
            .map((node) => summarize(node)),
          visibleComboboxes: Array.from(document.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], [class*='combobox'], [class*='search']"))
            .filter((node) => visible(node))
            .slice(0, 20)
            .map((node) => summarize(node)),
        };
      })
      .catch(() => null);
    throw new BridgeError(
      "DOM_SELECTOR_MISSING",
      `Input element not found for selectors ${selectors.join(", ")} :: ${JSON.stringify(diagnostics)}`,
    );
  }

  private async selectAllAgGridRows(page: Page) {
    // PropStream duplicates the grid (hidden + visible). Find the visible
    // resultIndex header cell by bounding box and click it to select all.
    const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
    const headerCount = await headerCells.count().catch(() => 0);
    for (let i = 0; i < headerCount; i++) {
      const box = await headerCells.nth(i).boundingBox().catch(() => null);
      if (box && box.width > 0) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(500);
        const checked = await page.evaluate(() => {
          const cbs = document.querySelectorAll('.ag-cell[col-id="resultIndex"] input[type="checkbox"]');
          let n = 0;
          for (let j = 0; j < cbs.length; j++) if ((cbs[j] as HTMLInputElement).checked) n++;
          return n;
        });
        if (checked > 0) {
          this.logStep("select-all-rows", { method: "header-checkbox", checked });
          return;
        }
      }
    }

    // Fallback: click each visible row's resultIndex cell
    const cells = page.locator('.ag-row .ag-cell[col-id="resultIndex"]');
    const cellCount = await cells.count().catch(() => 0);
    let clicked = 0;
    for (let i = 0; i < cellCount; i++) {
      const box = await cells.nth(i).boundingBox().catch(() => null);
      if (box && box.width > 0) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        clicked++;
      }
    }
    if (clicked > 0) {
      await page.waitForTimeout(500);
      this.logStep("select-all-rows", { method: "resultIndex-cells", clicked });
      return;
    }

    this.logStep("select-all-rows", { method: "none" });
  }

  private async clickBySelectors(page: Page, selectors: string[]) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        const clicked =
          (await locator.click({ timeout: 2_000 }).then(() => true).catch(() => false)) ||
          (await locator.evaluate((node: Element) => {
            if (node instanceof HTMLElement) {
              node.click();
              return true;
            }
            return false;
          }).catch(() => false));
        if (clicked) return true;
      }
    }
    return false;
  }

  private async clickByText(page: Page, pattern: RegExp) {
    const locator = page.getByText(pattern).first();
    if (await locator.count()) {
      const clicked =
        (await locator.click({ timeout: 2_000 }).then(() => true).catch(() => false)) ||
        (await locator.evaluate((node: Element) => {
          if (node instanceof HTMLElement) {
            node.click();
            return true;
          }
          return false;
        }).catch(() => false));
      if (clicked) return true;
    }
    return false;
  }

  private async clickVisibleButton(page: Page, textPattern: RegExp) {
    const patternStr = textPattern.source;
    const patternFlags = textPattern.flags;
    const rect = await page.evaluate(`
      (function() {
        var re = new RegExp(${JSON.stringify(patternStr)}, ${JSON.stringify(patternFlags)});
        var btns = document.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if (re.test((btns[i].textContent || "").trim())) {
            var r = btns[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && !btns[i].disabled)
              return { x: r.x, y: r.y, w: r.width, h: r.height };
          }
        }
        return null;
      })()
    `) as { x: number; y: number; w: number; h: number } | null;
    if (!rect) return false;
    await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
    return true;
  }

  private async invokeBridge<T>(page: Page, method: BridgeMethod, ...args: unknown[]): Promise<T | null> {
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await this.browser.refreshBridge().catch(() => undefined);
    return (await page
      .evaluate(
        ({ methodName, methodArgs }) => {
          const bridge = (window as typeof window & {
            __PS_RUNNER__?: Record<string, (...input: unknown[]) => unknown>;
          }).__PS_RUNNER__;
          const fn = bridge?.[methodName];
          if (typeof fn !== "function") return null;
          return fn(...methodArgs);
        },
        { methodName: method, methodArgs: args },
      )
      .catch(() => null)) as T | null;
  }

  private async waitForCondition(
    page: Page,
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    errorMessage: string,
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return;
      await page.waitForTimeout(200);
    }
    throw new BridgeError("DOM_SELECTOR_MISSING", errorMessage);
  }

  private async setBulkSelection(page: Page, checked: boolean, errorMessage: string) {
    const ok = await this.invokeBridge<boolean>(page, "setBulkSelection", checked);
    if (!ok) {
      throw new BridgeError("DOM_SELECTOR_MISSING", errorMessage);
    }
    await page.waitForTimeout(250);
  }

  private async openBulkAction(page: Page, label: string, errorMessage: string) {
    const menuOpened = await this.invokeBridge<boolean>(page, "openActionsMenu");
    if (!menuOpened) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Actions button missing");
    }
    await page.waitForTimeout(250);
    const actionOpened = await this.invokeBridge<boolean>(page, "openBulkActionByText", label);
    if (!actionOpened) {
      throw new BridgeError("DOM_SELECTOR_MISSING", errorMessage);
    }
    await page.waitForTimeout(300);
  }

  private async tryBulkSaveAction(page: Page, label: string) {
    try {
      const menuOpened = await this.invokeBridge<boolean>(page, "openActionsMenu");
      if (!menuOpened) return false;
      await page.waitForTimeout(250);
      const actionOpened = await this.invokeBridge<boolean>(page, "openBulkActionByText", label);
      if (!actionOpened) return false;
      await page.waitForTimeout(300);
      return true;
    } catch {
      return false;
    }
  }

  private async applyInputRange(page: Page, startIndex: number, endIndex: number) {
    await this.openBulkAction(page, "Input Range", "Input Range action missing");
    const rangeSet = await this.invokeBridge<boolean>(page, "setInputRange", startIndex, endIndex);
    if (!rangeSet) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Input range controls were not detected");
    }
    const shown = await this.invokeBridge<boolean>(page, "showPropertyRange");
    if (!shown) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Show Property Range button missing");
    }
    await page.waitForTimeout(1_000);
  }

  private async saveVisibleRangeToList(page: Page, options: {
    listName: string;
    startIndex: number;
    endIndex: number;
  }) {
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    const checkboxes = page.locator("[id^='property-'] input[type='checkbox']");
    const checkboxCount = await checkboxes.count().catch(() => 0);
    console.error(
      `[propstream] save-visible:diagnostics ${JSON.stringify({
        href: page.url(),
        checkboxCount,
      })}`,
    );
    if (!checkboxCount) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Visible result checkboxes were not detected");
    }
    let selected = 0;
    const start = Math.max(options.startIndex - 1, 0);
    const end = Math.min(options.endIndex, checkboxCount);
    for (let index = start; index < end; index += 1) {
      const checkbox = checkboxes.nth(index);
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) {
        await checkbox.evaluate((node) => (node as HTMLInputElement).click()).catch(() => undefined);
        await page.waitForTimeout(100);
      }
      const confirmed = await checkbox.isChecked().catch(() => false);
      if (confirmed) selected += 1;
    }
    console.error(`[propstream] save-visible:selected ${JSON.stringify({ selected })}`);
    if (!selected) {
      throw new BridgeError("ACTION_NOT_CONFIRMED", "Visible result checkboxes did not stay selected");
    }
    let saveClicked = false;
    const actionsToggle = page
      .locator('div[class*="Search-Results-style"] [class*="dropdownToggleBtn"]')
      .first();
    if (!(await actionsToggle.count().catch(() => 0))) {
      const fallbackToggle = page.locator('[class*="dropdownToggleBtn"]').filter({ hasText: /actions/i }).first();
      if (await fallbackToggle.count().catch(() => 0)) {
        await fallbackToggle.evaluate((node) => (node as HTMLElement).click()).catch(() => undefined);
        await page.waitForTimeout(400);
      }
    } else {
      await actionsToggle.evaluate((node) => (node as HTMLElement).click()).catch(() => undefined);
      await page.waitForTimeout(400);
    }
    const saveLabels = [/Add to Marketing List/i, /Add to Favorites/i, /Add to Group/i, /^Save$/i];
    for (const label of saveLabels) {
      if (saveClicked) break;
      const actionItem = page.getByText(label).last();
      if (await actionItem.isVisible().catch(() => false)) {
        saveClicked = await actionItem
          .evaluate((node) => {
            if (node instanceof HTMLElement) {
              node.click();
              return true;
            }
            return false;
          })
          .catch(() => false);
      }
    }
    if (!saveClicked) {
      saveClicked =
        (await this.clickByText(page, /add to marketing list/i)) ||
        (await this.clickByText(page, /add to favorites/i));
    }
    if (!saveClicked) {
      await this.browser.screenshot("save-no-click").catch(() => undefined);
      throw new BridgeError("DOM_SELECTOR_MISSING", "Search header Save button missing");
    }
    this.logStep("save-visible:save-clicked");
    await this.browser.screenshot("save-after-click").catch(() => undefined);
    await this.waitForSaveModal(page);
    this.logStep("save-visible:modal-found");
    await this.browser.screenshot("save-modal-visible").catch(() => undefined);
    await this.chooseListIfPresent(page, options.listName);
    this.logStep("save-visible:list-chosen", { listName: options.listName });
    await this.browser.screenshot("save-after-choose-list").catch(() => undefined);
    await page.waitForTimeout(800);
    this.quota.increment("saves", selected);
    this.lastSuccessfulStep = "visible-range-save-finished";
    return selected;
  }

  private async waitForSaveModal(page: Page, timeoutMs = 10_000) {
    await this.waitForCondition(
      page,
      async () => {
        for (const selector of SELECTORS.saveModals) {
          const locator = page.locator(selector).first();
          if (await locator.isVisible().catch(() => false)) {
            const text = await locator.innerText().catch(() => "");
            if (/list|marketing|group|save/i.test(text)) return true;
          }
        }
        for (const selector of SELECTORS.listInputs) {
          if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
        }
        return false;
      },
      timeoutMs,
      "Save list modal did not open",
    );
  }

  private async executeSearch(
    payload: SearchPayload,
    options?: { skipReadyCheck?: boolean; skipOpenSearch?: boolean; allowReauthRetry?: boolean },
  ): Promise<AcquisitionResult> {
    if (!options?.skipReadyCheck) {
      await this.ensureReady();
    }
    const page = options?.skipOpenSearch ? await this.browser.getPage() : await this.openSearch();
    this.logStep("search:start", { zip: payload.zip, filters: Object.keys(payload.filters || {}) });
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await this.setInputValue(page, SELECTORS.searchZipInputs, payload.zip);
    this.logStep("search:zip-entered", { zip: payload.zip });
    await this.applyFilters(page, payload.filters || {});
    this.logStep("search:filters-applied");
    const clicked =
      (await this.clickBySelectors(page, SELECTORS.applyButtons)) ||
      (await this.clickByText(page, /^search$/i)) ||
      (await this.clickByText(page, /search|apply|update/i));
    if (!clicked) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Search/apply button not found");
    }
    this.logStep("search:submitted");
    await page.waitForTimeout(2_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    let rows;
    try {
      rows = await this.waitForVisibleRows(page);
    } catch (error) {
      const href = page.url();
      if (
        options?.allowReauthRetry !== false &&
        /login\.propstream\.com/i.test(href) &&
        (await this.browser.attemptCredentialLoginOnCurrentPage().catch(() => false))
      ) {
        this.logStep("search:reauth-retry");
        return this.executeSearch(payload, {
          skipReadyCheck: false,
          skipOpenSearch: false,
          allowReauthRetry: false,
        });
      }
      throw error;
    }
    this.logStep("search:rows-visible", { count: rows.length });
    const extractedRows: Array<Record<string, unknown> & {
      property_id: string;
      route_hint: string | null;
      summary: string;
    }> = [];
    for (const [index, row] of rows.entries()) {
      this.logStep("search:reading-row", { index });
      const extracted = await row
        .evaluate((node) => {
          const anchor = node.querySelector("a[href]") as HTMLAnchorElement | null;
          return {
            text: (node.textContent || "").replace(/\s+/g, " ").trim(),
            href: anchor?.getAttribute("href") || null,
            dataId: node.getAttribute("data-id"),
            dataPropertyId: node.getAttribute("data-property-id"),
          };
        })
        .catch(() => ({
          text: "",
          href: null,
          dataId: null,
          dataPropertyId: null,
        }));
      const propertyId =
        extracted.dataId ||
        extracted.dataPropertyId ||
        extracted.href ||
        extracted.text.slice(0, 80) ||
        `row-${index + 1}`;
      extractedRows.push({
        property_id: propertyId,
        route_hint: extracted.href,
        summary: extracted.text,
      });
    }
    const looksLikePropertyRow = (item: { route_hint: string | null; summary: string }) => {
      const summary = String(item.summary || "");
      const href = String(item.route_hint || "");
      if (href && !href.startsWith("#")) return true;
      if (!summary) return false;
      if (/last 30 days|market trend|average days on market|new listings|closed sales|\$\/sqft|new pre-foreclosures/i.test(summary)) {
        return false;
      }
      if (/\b\d+\s+[a-z0-9.'-]+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|cir|circle|pl|place|trl|trail)\b/i.test(summary)) {
        return true;
      }
      if (/\b\d+\s*bed\b/i.test(summary) || /\b\d+(\.\d+)?\s*bath\b/i.test(summary)) {
        return true;
      }
      if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(summary)) {
        return true;
      }
      return false;
    };
    const items = extractedRows
      .filter((item) => looksLikePropertyRow(item))
      .slice(0, payload.max_results || 10);
    this.logStep("search:property-rows-filtered", { filtered: items.length, total: extractedRows.length });
    if (!items.length) {
      items.push(...extractedRows.slice(0, payload.max_results || 10));
    }
    this.logStep("search:results-read", { count: items.length });
    return {
      status: items.length ? "success" : "partial",
      items,
      errors: [],
    };
  }

  async search(payload: SearchPayload): Promise<AcquisitionResult> {
    return this.executeSearch(payload);
  }

  async searchInLiveSession(payload: SearchPayload): Promise<AcquisitionResult> {
    return this.executeSearch(payload, { skipReadyCheck: false, skipOpenSearch: true });
  }

  async searchCurrentPage(payload: SearchPayload): Promise<Array<Record<string, unknown>>> {
    const result = await this.search(payload);
    return result.items;
  }

  async scoutCounty(
    searchTerm: string,
    signals: string[] = ["pre_foreclosure", "tax_delinquent", "probate"],
  ): Promise<Array<{ signal: string; count: number }>> {
    await this.ensureReady();
    const results: Array<{ signal: string; count: number }> = [];

    for (const signal of signals) {
      const page = await this.openSearch();
      await this.dismissBlockingOverlays(page).catch(() => undefined);
      await this.setInputValue(page, SELECTORS.searchZipInputs, searchTerm);
      this.logStep("scout:search-term-entered", { searchTerm, signal });

      await this.applyFilters(page, { vacant: true, sfr_detached: true, [signal]: true });
      this.logStep("scout:filters-applied", { signal });

      const clicked =
        (await this.clickBySelectors(page, SELECTORS.applyButtons)) ||
        (await this.clickByText(page, /^search$/i)) ||
        (await this.clickByText(page, /search|apply|update/i));
      if (!clicked) {
        this.logStep("scout:search-button-not-found", { signal });
        results.push({ signal, count: 0 });
        continue;
      }

      this.logStep("scout:submitted", { signal });
      await page.waitForTimeout(3_000);
      await this.dismissBlockingOverlays(page).catch(() => undefined);

      const state = await this.browser.snapshot();
      const countText = state.result_count_text || "";
      const match = countText.match(/(\d[\d,]*)/);
      const count = match ? Number(match[1].replace(/,/g, "")) : 0;
      this.logStep("scout:result-count", { signal, count, raw: countText });
      results.push({ signal, count });
    }

    this.logStep("scout:complete", { searchTerm, results });
    return results;
  }

  private async applyFilters(page: Page, filters: Record<string, unknown>) {
    if (!Object.keys(filters).length) return;
    const opened =
      (await this.clickByText(page, /filters/i)) ||
      (await this.clickBySelectors(page, SELECTORS.filterButtons));
    if (!opened) return;
    this.lastSuccessfulStep = "filters-opened";
    await page.waitForTimeout(500);
    const toggles: Record<string, RegExp> = {
      sfr_detached: /single family/i,
      vacant: /vacant/i,
      tax_delinquent: /tax delinquen/i,
      pre_foreclosure: /pre[-\s]?foreclosure/i,
      probate: /pre[-\s]?probate|probate/i,
      high_equity: /high equity/i,
    };
    for (const [key, regex] of Object.entries(toggles)) {
      if (!filters[key]) continue;
      await this.clickByText(page, regex).catch(() => undefined);
      await page.waitForTimeout(150);
    }

    const hasRangeFilters =
      filters.equity_min !== undefined ||
      filters.equity_max !== undefined ||
      filters.max_price !== undefined ||
      filters.min_price !== undefined;
    if (!hasRangeFilters) return;

    await this.expandFilterSection(page, /value.*equity/i);
    await page.waitForTimeout(500);

    if (filters.equity_min !== undefined || filters.equity_max !== undefined) {
      await this.fillFilterRange(page, "Estimated Equity %", filters.equity_min as number | undefined, filters.equity_max as number | undefined);
    }
    if (filters.min_price !== undefined || filters.max_price !== undefined) {
      await this.fillFilterRange(page, "Estimated Value", filters.min_price as number | undefined, filters.max_price as number | undefined);
    }
  }

  private async expandFilterSection(page: Page, sectionPattern: RegExp) {
    const patternStr = sectionPattern.source;
    const patternFlags = sectionPattern.flags;
    const clicked = await page.evaluate(`
      (function() {
        var re = new RegExp(${JSON.stringify(patternStr)}, ${JSON.stringify(patternFlags)});
        var headings = document.querySelectorAll("h4, h3, h2, div, span, p");
        for (var i = 0; i < headings.length; i++) {
          var ownText = "";
          for (var j = 0; j < headings[i].childNodes.length; j++) {
            if (headings[i].childNodes[j].nodeType === 3) ownText += headings[i].childNodes[j].textContent;
          }
          if (re.test(ownText.trim())) {
            var r = headings[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.x < 400 && r.x > 50) {
              headings[i].click();
              return true;
            }
          }
        }
        return false;
      })()
    `);
    if (clicked) {
      this.logStep("filter-section-expanded", { pattern: patternStr });
    }
  }

  private async fillFilterRange(page: Page, labelText: string, minVal?: number, maxVal?: number) {
    const result = await page.evaluate(`
      (function() {
        var label = ${JSON.stringify(labelText)};
        var minVal = ${minVal !== undefined ? JSON.stringify(String(minVal)) : "null"};
        var maxVal = ${maxVal !== undefined ? JSON.stringify(String(maxVal)) : "null"};

        var headings = document.querySelectorAll("h4, h3, h2");
        var targetH = null;
        for (var i = 0; i < headings.length; i++) {
          var ownText = "";
          for (var j = 0; j < headings[i].childNodes.length; j++) {
            if (headings[i].childNodes[j].nodeType === 3) ownText += headings[i].childNodes[j].textContent;
          }
          if (ownText.trim() === label) {
            var r = headings[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.y > -100) {
              targetH = headings[i];
              break;
            }
          }
        }
        if (!targetH) return { found: false, label: label };

        var hRect = targetH.getBoundingClientRect();
        var inputs = document.querySelectorAll("input[placeholder='Min'], input[placeholder='Max']");
        var minInput = null;
        var maxInput = null;
        var bestMinDist = 999;
        var bestMaxDist = 999;

        for (var i = 0; i < inputs.length; i++) {
          var ir = inputs[i].getBoundingClientRect();
          if (ir.width <= 0 || ir.height <= 0) continue;
          var dy = ir.y - hRect.y;
          var dx = Math.abs(ir.x - hRect.x);
          if (dy > 0 && dy < 60 && dx < 250) {
            if (inputs[i].placeholder === "Min" && dy < bestMinDist) {
              bestMinDist = dy;
              minInput = inputs[i];
            }
            if (inputs[i].placeholder === "Max" && dy < bestMaxDist) {
              bestMaxDist = dy;
              maxInput = inputs[i];
            }
          }
        }

        var filled = [];
        if (minVal && minInput) {
          var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeSet.call(minInput, minVal);
          minInput.dispatchEvent(new Event("input", { bubbles: true }));
          minInput.dispatchEvent(new Event("change", { bubbles: true }));
          filled.push("min=" + minVal);
        }
        if (maxVal && maxInput) {
          var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeSet.call(maxInput, maxVal);
          maxInput.dispatchEvent(new Event("input", { bubbles: true }));
          maxInput.dispatchEvent(new Event("change", { bubbles: true }));
          filled.push("max=" + maxVal);
        }

        return { found: true, label: label, filled: filled };
      })()
    `);
    this.logStep("filter-range-filled", result as Record<string, unknown>);
  }

  async save(payload: SavePayload): Promise<AcquisitionResult> {
    await this.ensureReady();
    const page = await this.openSearch();
    const items: Array<Record<string, unknown>> = [];
    const errors: Array<{ code: string; message: string; item_ref?: string }> = [];
    for (const propertyId of payload.property_ids) {
      try {
        let row = page
          .locator(SELECTORS.resultRows.join(", "))
          .filter({ hasText: propertyId })
          .first();
        if (!(await row.count()) && /\/search\//i.test(propertyId)) {
          row = page
            .locator(SELECTORS.resultRows.join(", "))
            .filter({ has: page.locator(`a[href="${propertyId}"]`) })
            .first();
        }
        if (!(await row.count())) {
          throw new BridgeError("DOM_SELECTOR_MISSING", "Property row not found", { item_ref: propertyId });
        }
        const saveButton = row.locator(SELECTORS.saveButtons.join(", ")).first();
        if (!(await saveButton.count())) {
          throw new BridgeError("DOM_SELECTOR_MISSING", "Save button missing", { item_ref: propertyId });
        }
        await saveButton.click();
        await page.waitForTimeout(500);
        await this.chooseListIfPresent(page, payload.list_name);
        this.quota.increment("saves", 1);
        items.push({ property_id: propertyId, status: "success", verified: true });
      } catch (error) {
        const typed = error as BridgeError;
        errors.push({
          code: typed.code || "UNKNOWN",
          message: typed.message || "Save failed",
          item_ref: propertyId,
        });
      }
    }
    this.lastSuccessfulStep = "save-finished";
    return {
      status: errors.length ? (items.length ? "partial" : "failure") : "success",
      items,
      errors,
    };
  }

  private async findSaveModal(page: Page) {
    for (const selector of SELECTORS.saveModals) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        const text = await locator.innerText().catch(() => "");
        if (/list|marketing|group|save/i.test(text)) return locator;
      }
    }
    return null;
  }

  private async chooseListIfPresent(page: Page, listName: string) {
    const modal = await this.findSaveModal(page);
    const modalRoot = modal || page;

    let modalInput = null;
    for (const selector of SELECTORS.listInputs) {
      const candidate = modalRoot.locator(selector).first();
      if (await candidate.isVisible().catch(() => false)) {
        modalInput = candidate;
        break;
      }
    }
    if (!modalInput) {
      modalInput = modalRoot.locator("input").first();
      if (!(await modalInput.isVisible().catch(() => false))) return;
    }

    await modalInput.click({ timeout: 2_000 }).catch(() => undefined);
    await modalInput.fill(listName);
    await page.waitForTimeout(500);

    let optionClicked = false;
    for (const selector of SELECTORS.listOptions) {
      const option = modalRoot.locator(selector).filter({ hasText: listName }).first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        optionClicked = true;
        break;
      }
    }
    if (!optionClicked) {
      const anyOption = page.locator(SELECTORS.listOptions.join(", ")).filter({ hasText: listName }).first();
      if (await anyOption.isVisible().catch(() => false)) {
        await anyOption.click();
        optionClicked = true;
      }
    }
    if (!optionClicked) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(300);
    const modalButtonSelectors = [
      '[class*="AddToMarketingListModal"] button',
      '[class*="modalBox"] button',
      '[role="dialog"] button',
      '[aria-modal="true"] button',
    ];
    for (const sel of modalButtonSelectors) {
      const saveBtn = page.locator(sel).filter({ hasText: /save/i }).last();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click({ force: true });
        this.logStep("choose-list:confirm-clicked", { listName, selector: sel });
        await page.waitForTimeout(1_000);
        const modalStillOpen = await this.findSaveModal(page);
        if (!modalStillOpen) return;
        this.logStep("choose-list:modal-still-open-retrying");
      }
    }
    const anyVisibleSave = page.getByRole("button", { name: /^save$/i }).last();
    if (await anyVisibleSave.isVisible().catch(() => false)) {
      await anyVisibleSave.click({ force: true }).catch(() => undefined);
      this.logStep("choose-list:fallback-save-clicked");
    }
  }

  private async extractSearchParams(page: Page): Promise<{ countyId: number; fips: string; searchId: number } | null> {
    return page.evaluate(`(function(){
      var entries = performance.getEntriesByType("resource");
      for (var i = entries.length - 1; i >= 0; i--) {
        if (entries[i].name.includes("/listing") && entries[i].name.includes("countyId")) {
          try {
            var url = new URL(entries[i].name);
            return {
              countyId: parseInt(url.searchParams.get("countyId") || "0"),
              fips: url.searchParams.get("fips") || "",
              searchId: parseInt(url.searchParams.get("id") || "0")
            };
          } catch(e) {}
        }
      }
      return null;
    })()`) as unknown as { countyId: number; fips: string; searchId: number } | null;
  }

  /**
   * Save all search results to a marketing list via direct API call.
   * Bypasses the broken UI "Input Range" feature by calling PropStream's
   * save endpoint with inputRange=true and the full result range.
   * If countyId/fips are not provided, auto-extracts from browser network state.
   */
  async saveAllViaApi(options: {
    listName: string;
    totalCount: number;
    countyId?: number;
    fips?: string;
    searchId?: number;
  }): Promise<number> {
    await this.ensureReady();
    const page = await this.browser.getPage();

    let countyId = options.countyId;
    let fips = options.fips;
    let searchId = options.searchId;

    if (!countyId || !fips) {
      const params = await this.extractSearchParams(page);
      if (params) {
        countyId = countyId ?? params.countyId;
        fips = fips ?? params.fips;
        searchId = searchId ?? params.searchId;
      }
    }

    if (!countyId || !fips) {
      throw new BridgeError("MISSING_PARAMS", "Could not extract countyId/fips from search session");
    }

    const bodyObj = {
      endRange: options.totalCount,
      countyId,
      fips,
      addressType: "N",
      resultOffset: 1,
      inputRange: true,
      type: null,
      id: searchId ?? countyId,
      startRange: 1,
      estimatedValueGrowthPeriod: "ONE_MONTH",
      resultLimit: options.totalCount,
      listingType: "DEC",
      selection: [] as number[],
      selectionInversed: false,
    };
    const bodyStr = JSON.stringify(bodyObj);
    const encodedName = encodeURIComponent(options.listName);

    const result = await page.evaluate(`(function(){
      return new Promise(function(resolve) {
        fetch("/eqbackend/resource/auth/ps4/user/listings?groupType=MARKETING&groupName=${encodedName}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: ${JSON.stringify(bodyStr)}
        })
        .then(function(r) { return r.json().then(function(j) { return { status: r.status, data: j }; }); })
        .then(resolve)
        .catch(function(e) { resolve({ status: 0, error: e.message }); });
      });
    })()`) as { status: number; data?: unknown; error?: string };

    if (result.status !== 200) {
      throw new BridgeError("API_ERROR", `Save API returned ${result.status}: ${result.error || "unknown"}`);
    }

    this.logStep("save-all-api:success", {
      listName: options.listName,
      totalCount: options.totalCount,
      status: result.status,
    });
    this.quota.increment("saves", options.totalCount);
    this.lastSuccessfulStep = "bulk-save-api-finished";
    return options.totalCount;
  }

  async saveSearchRangeToList(options: {
    listName: string;
    startIndex: number;
    endIndex: number;
  }) {
    await this.ensureReady();
    const page = await this.openSearch();
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    // Close filter panel if open (it intercepts pointer events)
    await page.evaluate(`
      (function() {
        var panel = document.querySelector('[class*="searchFilterNew"][class*="dropdown"]');
        if (panel) {
          var r = panel.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            var close = panel.querySelector('[class*="dropdownToggleBtn"]');
            if (close) close.click();
          }
        }
      })()
    `);
    await page.waitForTimeout(500);
    try {
      // Select all visible checkboxes first
      const masterChecked = await page.evaluate(`
        (function() {
          var checkboxes = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
          var checked = 0;
          for (var i = 0; i < checkboxes.length; i++) {
            if (!checkboxes[i].checked) {
              checkboxes[i].click();
            }
            if (checkboxes[i].checked) checked++;
          }
          return checked;
        })()
      `);
      this.logStep("save-range:selected-visible", { checked: masterChecked });
      this.lastSuccessfulStep = "bulk-selection-enabled";

      // Try Input Range flow: Actions → Input Range → fill → Show Property Range
      const actionsClicked = await this.clickVisibleButton(page, /^Actions$/);
      if (actionsClicked) {
        await page.waitForTimeout(500);
        const inputRangeItem = page.getByText("Input Range", { exact: true }).last();
        if (await inputRangeItem.isVisible().catch(() => false)) {
          await inputRangeItem.click();
          this.logStep("save-range:input-range-opened");
          await page.waitForTimeout(500);

          // Fill start and end inputs
          const rangeFilled = await page.evaluate(`
            (function() {
              var start = ${JSON.stringify(String(options.startIndex))};
              var end = ${JSON.stringify(String(options.endIndex))};
              var inputs = document.querySelectorAll("input[type='text'], input[type='number']");
              var rangeInputs = [];
              for (var i = 0; i < inputs.length; i++) {
                var r = inputs[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.width < 120) {
                  var ph = (inputs[i].placeholder || "").toLowerCase();
                  if (/start|from|^$/.test(ph) || /end|to|^$/.test(ph)) {
                    rangeInputs.push(inputs[i]);
                  }
                }
              }
              if (rangeInputs.length < 2) return { filled: false, found: rangeInputs.length };
              var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              nativeSet.call(rangeInputs[0], start);
              rangeInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
              rangeInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
              nativeSet.call(rangeInputs[1], end);
              rangeInputs[1].dispatchEvent(new Event("input", { bubbles: true }));
              rangeInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
              return { filled: true, start: start, end: end };
            })()
          `);
          this.logStep("save-range:range-filled", rangeFilled as Record<string, unknown>);

          if (rangeFilled && (rangeFilled as { filled: boolean }).filled) {
            // Click "Show Property Range"
            await page.waitForTimeout(300);
            const showRange = await this.clickVisibleButton(page, /show property range/i);
            if (showRange) {
              this.logStep("save-range:show-property-range-clicked");
              await page.waitForTimeout(1500);
              this.lastSuccessfulStep = "bulk-range-applied";

              // Now select all in the new range and save
              await page.evaluate(`
                (function() {
                  var checkboxes = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
                  for (var i = 0; i < checkboxes.length; i++) {
                    if (!checkboxes[i].checked) checkboxes[i].click();
                  }
                })()
              `);
              this.lastSuccessfulStep = "bulk-range-selected";
            }
          }
        }
      }

      // Now open Actions → Add to Marketing List
      const saveActionsClicked = await this.clickVisibleButton(page, /^Actions$/);
      if (saveActionsClicked) {
        await page.waitForTimeout(500);
      }
      let saveClicked = false;
      for (const label of ["Add to Marketing List", "Add to Favorites List", "Save"]) {
        const item = page.getByText(label, { exact: true }).last();
        if (await item.isVisible().catch(() => false)) {
          const clicked = await item.evaluate((node: Element) => {
            if (node instanceof HTMLElement) { node.click(); return true; }
            return false;
          }).catch(() => false);
          if (clicked) {
            saveClicked = true;
            this.logStep("save-range:save-action-clicked", { label });
            break;
          }
        }
      }
      if (!saveClicked) {
        throw new BridgeError("DOM_SELECTOR_MISSING", "Save action not found in Actions menu");
      }

      await this.waitForSaveModal(page);
      await this.chooseListIfPresent(page, options.listName);
      await page.waitForTimeout(800);
      const count = Math.max(options.endIndex - options.startIndex + 1, 0);
      this.quota.increment("saves", count);
      this.lastSuccessfulStep = "bulk-save-finished";
      return count;
    } catch (error) {
      console.error(
        `[propstream] save-range:visible-fallback ${JSON.stringify({
          code: (error as { code?: string })?.code || "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        })}`,
      );
      return this.saveVisibleRangeToList(page, options);
    }
  }

  async exportList(payload: ExportPayload): Promise<AcquisitionResult> {
    await this.ensureReady();
    const page = await this.browser.getPage();
    const currentRoute = page.url();
    if (!/property\/group/i.test(currentRoute)) {
      await this.navigateToListByName(page, payload.list_name);
    }
    this.logStep("export:on-list-page", { href: page.url() });

    await this.selectAllAgGridRows(page);
    this.logStep("export:selected-all");

    await this.browser.screenshot("export-before-click").catch(() => undefined);

    // PropStream duplicates its toolbar (hidden + visible copy). Use the
    // Actions → Export CSV dropdown path to get a CSV file (the toolbar
    // Export button produces XLSX which we can't parse). Fall back to
    // clicking the visible Export button directly if Actions isn't found.
    let exportClicked = false;
    const actionsRect = await page.evaluate(`
      (function() {
        var btns = document.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || "").trim() === "Actions") {
            var r = btns[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
          }
        }
        return null;
      })()
    `) as { x: number; y: number; w: number; h: number } | null;

    const downloadPromise = this.browser.waitForDownload();

    if (actionsRect) {
      await page.mouse.click(actionsRect.x + actionsRect.w / 2, actionsRect.y + actionsRect.h / 2);
      this.logStep("export:actions-opened");
      await page.waitForTimeout(1_000);
      const exportCsv = page.getByText("Export CSV", { exact: true }).last();
      if (await exportCsv.isVisible().catch(() => false)) {
        await exportCsv.click();
        exportClicked = true;
        this.logStep("export:csv-clicked");
      }
    }

    if (!exportClicked) {
      // Fallback: click visible Export button by coordinates
      const exportRect = await page.evaluate(`
        (function() {
          var btns = document.querySelectorAll("button");
          for (var i = 0; i < btns.length; i++) {
            if (/^Export$/i.test((btns[i].textContent || "").trim())) {
              var r = btns[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && !btns[i].disabled)
                return { x: r.x, y: r.y, w: r.width, h: r.height };
            }
          }
          return null;
        })()
      `) as { x: number; y: number; w: number; h: number } | null;

      if (exportRect) {
        await page.mouse.click(exportRect.x + exportRect.w / 2, exportRect.y + exportRect.h / 2);
        exportClicked = true;
        this.logStep("export:button-clicked");
      }
    }

    if (!exportClicked) {
      // Final fallback for mock/simple environments
      exportClicked =
        (await this.clickByText(page, /^export$/i)) ||
        (await this.clickBySelectors(page, SELECTORS.exportButtons));
    }

    if (!exportClicked) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Export button/option not found");
    }
    this.lastSuccessfulStep = "export-clicked";
    this.logStep("export:clicked");
    await page.waitForTimeout(2_000);
    await this.browser.screenshot("export-after-click").catch(() => undefined);

    let download;
    try {
      download = await downloadPromise;
    } catch {
      await this.browser.screenshot("export-timeout").catch(() => undefined);
      throw new BridgeError("EXECUTION_TIMEOUT", "Export download did not start within timeout");
    }
    const records = await this.parseDownload(download);
    this.quota.increment("exports", records.length || 1);
    this.lastSuccessfulStep = "export-downloaded";
    this.logStep("export:downloaded", { records: records.length });

    await this.clickByText(page, /^close$/i).catch(() => undefined);

    return {
      status: records.length ? "success" : "partial",
      items: records,
      errors: records.length
        ? []
        : [{ code: "EXPORT_CAPTURE_PARTIAL", message: "Export completed but no rows were parsed" }],
    };
  }

  async skipTrace(payload: SkipTracePayload): Promise<AcquisitionResult> {
    await this.ensureReady();
    const useBatchRoute = payload.prefer_batch_route !== false;
    if (!useBatchRoute) {
      return this.skipTraceModal(payload);
    }
    if (useBatchRoute || payload.property_ids.length >= 5) {
      const items = await this.skipTraceBatch(payload);
      return {
        status: items.length ? "success" : "partial",
        items,
        errors: [],
      };
    }
    return this.skipTraceModal(payload);
  }

  async skipTraceOrderOnly(listName: string, count: number): Promise<void> {
    await this.ensureReady();
    const page = await this.browser.getPage();
    await this.navigateToListByName(page, listName);
    this.logStep("skip-trace-order:navigated", { list_name: listName });
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await this.selectAllAgGridRows(page);
    await this.dismissBlockingOverlays(page).catch(() => undefined);

    const clicked =
      (await this.clickVisibleButton(page, /^Skip Trace$/i)) ||
      (await this.clickByText(page, /skip trace/i)) ||
      (await this.clickBySelectors(page, SELECTORS.skipTraceButtons));
    if (!clicked) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Skip trace trigger missing");
    }
    this.logStep("skip-trace-order:button-clicked");

    // Wait longer for the modal — PropStream can be slow
    for (let waitAttempt = 0; waitAttempt < 5; waitAttempt++) {
      await page.waitForTimeout(2_000);
      await this.dismissBlockingOverlays(page).catch(() => undefined);

      // Scan ALL visible modals/dialogs/overlays for skip trace content
      const modalInfo = await page.evaluate(`(function(){
        var candidates = document.querySelectorAll(
          '[role="dialog"], [aria-modal="true"], [class*="Modal"], [class*="modal"], [class*="overlay"], [class*="Overlay"]'
        );
        var results = [];
        for (var i = 0; i < candidates.length; i++) {
          var r = candidates[i].getBoundingClientRect();
          if (r.width > 100 && r.height > 100) {
            var text = (candidates[i].innerText || "").substring(0, 500);
            results.push({
              selector: candidates[i].className.substring(0, 100),
              text: text,
              visible: r.width > 0 && r.height > 0,
              bounds: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            });
          }
        }
        return results;
      })()`) as Array<{ selector: string; text: string; visible: boolean }>;

      if (modalInfo.length > 0) {
        this.logStep("skip-trace-order:modals-found", { count: modalInfo.length, selectors: modalInfo.map(m => m.selector.substring(0, 50)) });

        for (const modal of modalInfo) {
          if (/skip trace|order details|place order|eligible contacts|skip-trace/i.test(modal.text)) {
            this.logStep("skip-trace-order:modal-matched", { text: modal.text.substring(0, 100) });

            // Try to fill in list name if there's an input
            const stListName = listName || `swarm-skip-${Date.now()}`;
            const inputInfo = await page.evaluate(`(function(){
              var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
              for (var i = 0; i < inputs.length; i++) {
                var r = inputs[i].getBoundingClientRect();
                var ph = (inputs[i].placeholder || "").toLowerCase();
                if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 600) {
                  if (ph.includes("list") || ph.includes("name") || ph.includes("enter") || ph === "") {
                    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
                  }
                }
              }
              return null;
            })()`);
            if (inputInfo) {
              await page.mouse.click((inputInfo as any).x, (inputInfo as any).y, { clickCount: 3 });
              await page.waitForTimeout(100);
              await page.keyboard.type(stListName, { delay: 20 });
              await page.waitForTimeout(500);
            }

            // Check "re-skip trace" if present
            await page.evaluate(`(function(){
              var els = document.querySelectorAll("label, span, div, p, input[type='checkbox']");
              for (var i = 0; i < els.length; i++) {
                if (/re-skip trace|re.skip/i.test(els[i].textContent || "")) {
                  var r = els[i].getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) { els[i].click(); return true; }
                }
              }
              return false;
            })()`);
            await page.waitForTimeout(300);

            // Find and click "Place Order" / "Submit" / "Confirm"
            let ordered = false;
            for (let btnWait = 0; btnWait < 10; btnWait++) {
              const orderState = await page.evaluate(`(function(){
                var btns = document.querySelectorAll("button, a[role='button']");
                for (var i = 0; i < btns.length; i++) {
                  var txt = (btns[i].textContent || "").trim();
                  if (/place order|submit order|confirm|order now/i.test(txt)) {
                    var r = btns[i].getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                      return { visible: true, disabled: btns[i].disabled, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: txt };
                    }
                  }
                }
                return { visible: false };
              })()`) as { visible: boolean; disabled?: boolean; x?: number; y?: number; text?: string };
              if (orderState?.visible && !orderState?.disabled && orderState.x && orderState.y) {
                await page.mouse.click(orderState.x, orderState.y);
                ordered = true;
                this.logStep("skip-trace-order:placed", { buttonText: orderState.text });
                await page.waitForTimeout(3_000);
                break;
              }
              await page.waitForTimeout(1_000);
            }
            if (ordered) {
              this.quota.increment("skip_trace", count);
              await this.clickByText(page, /close|ok|done/i).catch(() => undefined);
              await page.waitForTimeout(1_000);
              await this.dismissBlockingOverlays(page).catch(() => undefined);
              return;
            }
            this.logStep("skip-trace-order:button-not-found-in-modal");
          }
        }
      }
    }

    // Take a screenshot for debugging if we got here without placing the order
    await this.browser.screenshot("skip-trace-order-failed").catch(() => undefined);
    this.logStep("skip-trace-order:no-modal-detected-after-retries");
    this.quota.increment("skip_trace", count);
    await this.clickByText(page, /close|ok|done/i).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);
  }

  private async skipTraceBatch(payload: SkipTracePayload) {
    const page = await this.browser.getPage();
    await this.navigateToListByName(page, payload.list_name);
    this.logStep("skip-trace-batch:navigated-to-list", { list_name: payload.list_name, url: page.url() });
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await this.browser.screenshot("skip-trace-after-nav").catch(() => undefined);

    await this.selectAllAgGridRows(page);

    await this.dismissBlockingOverlays(page).catch(() => undefined);

    const clicked =
      (await this.clickVisibleButton(page, /^Skip Trace$/i)) ||
      (await this.clickByText(page, /skip trace/i)) ||
      (await this.clickBySelectors(page, SELECTORS.skipTraceButtons));
    if (!clicked) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Skip trace trigger missing");
    }
    this.logStep("skip-trace-batch:button-clicked");
    await page.waitForTimeout(2_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await this.browser.screenshot("skip-trace-after-click").catch(() => undefined);

    let skipTraceModalFound = false;
    for (const selector of SELECTORS.skipTraceModals) {
      const modal = page.locator(selector).first();
      if (await modal.isVisible().catch(() => false)) {
        const text = await modal.innerText().catch(() => "");
        if (/skip trace|order details|place order|eligible contacts/i.test(text)) {
          skipTraceModalFound = true;
          this.logStep("skip-trace-batch:modal-found");

          // Fill list name via coordinate-based input (Playwright locators miss this input)
          const stListName = payload.list_name || `swarm-skip-${Date.now()}`;
          const inputInfo = await page.evaluate(`(function(){
            var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
            for (var i = 0; i < inputs.length; i++) {
              var r = inputs[i].getBoundingClientRect();
              var ph = (inputs[i].placeholder || "").toLowerCase();
              if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 500) {
                if (ph.includes("list") || ph.includes("name") || ph.includes("enter")) {
                  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
                }
              }
            }
            return null;
          })()`);
          if (inputInfo) {
            await page.mouse.click((inputInfo as any).x, (inputInfo as any).y, { clickCount: 3 });
            await page.waitForTimeout(100);
            await page.keyboard.type(stListName, { delay: 20 });
            this.logStep("skip-trace-batch:name-filled", { name: stListName });
            await page.waitForTimeout(500);
          }

          // Enable "Re-Skip Trace" if present
          await page.evaluate(`(function(){
            var els = document.querySelectorAll("label, span, div, p");
            for (var i = 0; i < els.length; i++) {
              if (/re-skip trace/i.test(els[i].textContent || "")) {
                var r = els[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) { els[i].click(); return true; }
              }
            }
            return false;
          })()`);
          this.logStep("skip-trace-batch:re-skip-trace-toggled");
          await page.waitForTimeout(300);

          // Click Place Order — poll until enabled
          let ordered = false;
          for (let wait = 0; wait < 8; wait++) {
            const orderState = await page.evaluate(`(function(){
              var btns = document.querySelectorAll("button");
              for (var i = 0; i < btns.length; i++) {
                if (/place order/i.test((btns[i].textContent || "").trim())) {
                  var r = btns[i].getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return { visible: true, disabled: btns[i].disabled, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
                  }
                }
              }
              return { visible: false };
            })()`) as { visible: boolean; disabled?: boolean; x?: number; y?: number };
            if (orderState?.visible && !orderState?.disabled && orderState.x && orderState.y) {
              await page.mouse.click(orderState.x, orderState.y);
              ordered = true;
              this.logStep("skip-trace-batch:order-placed");
              await page.waitForTimeout(5_000);
              break;
            }
            await page.waitForTimeout(1_000);
          }
          if (!ordered) {
            this.logStep("skip-trace-batch:order-failed");
          }
          break;
        }
      }
    }

    if (!skipTraceModalFound) {
      this.logStep("skip-trace-batch:no-modal-fallback");
      await this.clickByText(page, /confirm|continue|start|place order/i).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    this.lastSuccessfulStep = "skip-trace-batch-started";
    this.quota.increment("skip_trace", payload.property_ids.length);

    // Dismiss any post-order modals/dialogs
    await this.clickByText(page, /close|ok|done/i).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);

    // Wait for skip trace processing — PropStream processes async.
    // Scale wait time by number of records being traced.
    const traceCount = payload.property_ids.length;
    const traceWaitSec = traceCount >= 1000 ? 180 : traceCount >= 500 ? 120 : traceCount >= 100 ? 70 : 30;
    this.logStep("skip-trace-batch:waiting-for-processing", { traceCount, traceWaitSec });
    await page.waitForTimeout(traceWaitSec * 1000);

    // Re-navigate to the list to get a fresh page with skip trace data populated
    await this.navigateToListByName(page, payload.list_name);
    this.logStep("skip-trace-batch:re-navigated-for-export", { url: page.url() });

    // Wait for AG-Grid rows to be populated
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      const rowCount = await page.locator(".ag-row").count().catch(() => 0);
      if (rowCount > 0) {
        this.logStep("skip-trace-batch:grid-ready", { rows: rowCount });
        break;
      }
      await page.waitForTimeout(1_000);
    }

    const exported = await this.exportList({ command_type: "EXPORT", list_name: payload.list_name });
    return exported.items;
  }

  private async skipTraceModal(payload: SkipTracePayload): Promise<AcquisitionResult> {
    const page = await this.browser.getPage();
    const items: Array<Record<string, unknown>> = [];
    const errors: Array<{ code: string; message: string; item_ref?: string }> = [];
    for (const propertyId of payload.property_ids) {
      try {
        let row = page.locator(SELECTORS.resultRows.join(", ")).filter({ hasText: propertyId }).first();
        if (!(await row.count()) && /\/search\//i.test(propertyId)) {
          row = page
            .locator(SELECTORS.resultRows.join(", "))
            .filter({ has: page.locator(`a[href="${propertyId}"]`) })
            .first();
        }
        if (!(await row.count())) {
          throw new BridgeError("DOM_SELECTOR_MISSING", "Property row not found", { item_ref: propertyId });
        }
        const button = row.locator(SELECTORS.skipTraceButtons.join(", ")).first();
        if (!(await button.count())) {
          throw new BridgeError("DOM_SELECTOR_MISSING", "Skip trace button missing", { item_ref: propertyId });
        }
        await button.click();
        await page.waitForTimeout(1_000);
        const modal = page.locator("[role='dialog'], [aria-modal='true'], aside").filter({ hasText: /phone|email|contact/i }).first();
        if (!(await modal.count())) {
          throw new BridgeError("ACTION_NOT_CONFIRMED", "Skip trace modal failed to open", { item_ref: propertyId });
        }
        const phoneLinks = await modal.locator("a[href^='tel:']").evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLAnchorElement).href.replace(/^tel:/i, "")),
        );
        const emailLinks = await modal.locator("a[href^='mailto:']").evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLAnchorElement).href.replace(/^mailto:/i, "")),
        );
        this.quota.increment("skip_trace", 1);
        items.push({
          property_id: propertyId,
          phone_numbers: phoneLinks.map((value) => ({ value, type: "unknown" })),
          email_addresses: emailLinks,
          contacts_returned: phoneLinks.length + emailLinks.length,
          status: "success",
        });
      } catch (error) {
        const typed = error as BridgeError;
        errors.push({
          code: typed.code || "UNKNOWN",
          message: typed.message || "Skip trace failed",
          item_ref: propertyId,
        });
      }
    }
    this.lastSuccessfulStep = "skip-trace-modal-finished";
    return {
      status: errors.length ? (items.length ? "partial" : "failure") : "success",
      items,
      errors,
    };
  }

  async quotaCheck(): Promise<AcquisitionResult> {
    await this.ensureReady();
    await this.browser.gotoUsagePage();
    const page = await this.browser.getPage();
    await page.waitForLoadState("domcontentloaded");
    const text = await page.locator(SELECTORS.usageCounterRegions.join(", ")).allInnerTexts().catch(() => []);
    const joined = text.join("\n") || (await page.locator("body").innerText());
    const counters = {
      saves: this.extractQuota(joined, /save/i),
      exports: this.extractQuota(joined, /export/i),
      skip_trace: this.extractQuota(joined, /skip trace/i),
      monitor: this.extractQuota(joined, /monitor/i),
    };
    if (Object.values(counters).some((value) => value === null)) {
      throw new BridgeError("DOM_SELECTOR_MISSING", "Quota counters were not fully detected");
    }
    this.quota.reconcile(counters as Record<"saves" | "exports" | "skip_trace" | "monitor", number>);
    this.lastSuccessfulStep = "quota-read";
    return {
      status: "success",
      items: [counters as Record<string, unknown>],
      errors: [],
    };
  }

  private extractQuota(text: string, labelRegex: RegExp) {
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      if (!labelRegex.test(line)) continue;
      const match = line.match(/(\d[\d,]*)\s*(?:\/|\bof\b)?\s*(\d[\d,]*)?/i);
      if (match) {
        const first = Number(match[1].replace(/,/g, ""));
        const second = match[2] ? Number(match[2].replace(/,/g, "")) : null;
        if (second !== null) return Math.max(second - first, 0);
        return first;
      }
    }
    return null;
  }

  private async navigateToListByName(page: Page, listName: string) {
    await this.browser.gotoSavedListPage();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_000);

    const href = page.url();
    if (/login\.propstream\.com/i.test(href) || (await page.locator('input[type="password"]').count().catch(() => 0)) > 0) {
      this.logStep("navigate-to-list:auth-redirect-detected");
      await this.browser.attemptCredentialLoginOnCurrentPage().catch(() => undefined);
      await page.waitForTimeout(8_000);
      await this.browser.gotoSavedListPage();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2_000);
    }

    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await page.waitForTimeout(1_500);
    this.logStep("navigate-to-list:loaded", { listName });

    const escapedName = listName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Strategy 1: Click the labelName div inside the LeftPanel (PropStream CSS-modules)
    const labelName = page.locator('[class*="labelName"]').filter({ hasText: new RegExp(`^${escapedName}$`) }).first();
    if (await labelName.isVisible().catch(() => false)) {
      await labelName.click();
      await page.waitForTimeout(2_000);
      this.logStep("navigate-to-list:clicked-label", { listName });
      return;
    }

    // Strategy 2: Click any list item node that contains the name
    const listItem = page.locator('[class*="LeftPanel-style"][class*="item"]').filter({ hasText: listName }).first();
    if (await listItem.isVisible().catch(() => false)) {
      await listItem.click();
      await page.waitForTimeout(2_000);
      this.logStep("navigate-to-list:clicked-item", { listName });
      return;
    }

    // Strategy 3: Use evaluate to locate the element, then Playwright click
    const labelIndex = await page.evaluate((name: string) => {
      const allLabels = Array.from(document.querySelectorAll('[class*="labelName"]'));
      const idx = allLabels.findIndex((el) => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        return t === name;
      });
      return idx;
    }, listName);
    if (labelIndex >= 0) {
      // The LeftPanel items have zero dimensions due to overflow:hidden containers.
      // Dispatch a click to trigger React Router navigation — the resulting URL
      // contains a literal ":groupId" placeholder + the actual list group ID.
      const target = page.locator('[class*="labelName"]').nth(labelIndex);
      await target.dispatchEvent("click");
      await page.waitForTimeout(1_000);
      const clickUrl = page.url();

      // Extract the group ID from URLs like /property/group/:groupId/5259893
      const groupIdMatch = clickUrl.match(/property\/group\/[^/]+\/(\d+)/);
      if (groupIdMatch) {
        const groupId = groupIdMatch[1];
        const origin = new URL(clickUrl).origin;
        await page.goto(`${origin}/property/group/${groupId}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(2_000);
        await this.dismissBlockingOverlays(page).catch(() => undefined);
        this.logStep("navigate-to-list:navigated-to-group", { listName, groupId, url: page.url() });
        return;
      }

      this.logStep("navigate-to-list:dispatched-click-fallback", { listName, labelIndex, url: clickUrl });
    }

    // Strategy 4: Find the LeftPanel item node and click it
    const itemNode = page.locator('[class*="LeftPanel-style"][class*="node"]').filter({ hasText: listName }).first();
    if (await itemNode.isVisible().catch(() => false)) {
      await itemNode.click();
      await page.waitForTimeout(2_000);
      this.logStep("navigate-to-list:clicked-node", { listName });
      return;
    }

    // Strategy 4: Fallback to page-wide getByText
    const anywhereExact = page.getByText(listName, { exact: true }).first();
    if (await anywhereExact.isVisible().catch(() => false)) {
      await anywhereExact.click();
      await page.waitForTimeout(1_000);
      this.logStep("navigate-to-list:clicked-anywhere");
      return;
    }

    const debugInfo = await page.evaluate((name: string) => {
      const labels = Array.from(document.querySelectorAll('[class*="labelName"]'));
      return {
        labelCount: labels.length,
        labelTexts: labels.map((el) => (el.textContent || "").trim()).slice(0, 10),
        bodyHasName: (document.body.innerText || "").includes(name),
      };
    }, listName);
    this.logStep("navigate-to-list:debug", debugInfo);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new BridgeError(
      "DOM_SELECTOR_MISSING",
      `Saved list not found: ${listName} :: visible-lists-preview: ${bodyText.slice(0, 500)}`,
    );
  }

  private async parseDownload(download: Download) {
    const target = await download.path();
    if (!target) return [];
    const content = await readFile(target, "utf8");
    this._lastExportCsv = content;
    return mapExportRows(parseCsv(content));
  }

  async exportListCsv(listName: string, saveTo: string): Promise<{ rows: number; path: string }> {
    await this.ensureReady();
    const page = await this.browser.getPage();
    await this.navigateToListByName(page, listName);
    await page.waitForTimeout(3_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      const rowCount = await page.locator(".ag-row").count().catch(() => 0);
      if (rowCount > 0) break;
      await page.waitForTimeout(1_000);
    }
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await this.selectAllAgGridRows(page);
    await page.waitForTimeout(500);

    let exportClicked = false;
    const actionsRect = await page.evaluate(`
      (function() {
        var btns = document.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || "").trim() === "Actions") {
            var r = btns[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.y > 50 && r.y < 250)
              return { x: r.x, y: r.y, w: r.width, h: r.height };
          }
        }
        return null;
      })()
    `) as { x: number; y: number; w: number; h: number } | null;
    const downloadPromise = this.browser.waitForDownload(90_000);
    if (actionsRect) {
      this.logStep("export:actions-found", { actionsRect });
      await page.mouse.click(actionsRect.x + actionsRect.w / 2, actionsRect.y + actionsRect.h / 2);
      await page.waitForTimeout(1_500);
      const exportCsv = page.getByText("Export CSV", { exact: true }).last();
      if (await exportCsv.isVisible().catch(() => false)) {
        await exportCsv.click();
        exportClicked = true;
        this.logStep("export:csv-clicked");
      } else {
        this.logStep("export:csv-not-visible");
      }
    } else {
      this.logStep("export:actions-not-found");
    }
    if (!exportClicked) {
      exportClicked =
        (await this.clickByText(page, /^export$/i)) ||
        (await this.clickBySelectors(page, SELECTORS.exportButtons));
      if (exportClicked) this.logStep("export:fallback-clicked");
    }
    if (!exportClicked) {
      await page.screenshot({ path: "/tmp/export-debug-no-button.png" }).catch(() => undefined);
      throw new BridgeError("DOM_SELECTOR_MISSING", "Export button not found");
    }
    await page.waitForTimeout(2_000);
    // Handle potential confirmation dialogs (e.g., "Include skip trace data?")
    const confirmBtn = page.locator('button:has-text("Yes"), button:has-text("OK"), button:has-text("Confirm"), button:has-text("Download")').first();
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      this.logStep("export:confirmation-dialog-found");
      await confirmBtn.click();
      await page.waitForTimeout(2_000);
    }
    let download;
    try {
      download = await downloadPromise;
    } catch (e) {
      await page.screenshot({ path: "/tmp/export-debug-timeout.png" }).catch(() => undefined);
      throw e;
    }
    const target = await download.path();
    if (!target) throw new BridgeError("EXECUTION_TIMEOUT", "Download path unavailable");
    const content = await readFile(target, "utf8");
    const { writeFile: writeFileAsync } = await import("node:fs/promises");
    await writeFileAsync(saveTo, content, "utf8");
    const rows = content.split("\n").filter((l: string) => l.trim()).length - 1;
    this.logStep("export-csv:saved", { path: saveTo, rows });
    await this.clickByText(page, /^close$/i).catch(() => undefined);
    return { rows, path: saveTo };
  }

  async dispatchRecoveryAction(action: string) {
    switch (action) {
      case "refresh_current_page":
        await this.browser.refreshPage();
        break;
      case "reopen_search_page":
        await this.browser.gotoSearchPage();
        break;
      case "reopen_filters_panel": {
        const page = await this.browser.getPage();
        const opened =
          (await this.clickByText(page, /filters/i)) ||
          (await this.clickBySelectors(page, SELECTORS.filterButtons));
        if (!opened) {
          throw new BridgeError("DOM_SELECTOR_MISSING", "Filters button missing during recovery");
        }
        break;
      }
      case "retry_alternate_selector_family":
        await this.browser.refreshPage();
        break;
      case "reopen_property_detail_panel":
      case "reopen_saved_list_page":
        await this.browser.gotoSavedListPage();
        break;
      case "wait_for_route_stabilization": {
        const page = await this.browser.getPage();
        await page.waitForTimeout(2_000);
        break;
      }
      case "capture_trace_and_escalate":
        await this.browser.captureTrace("escalation");
        await this.browser.screenshot("escalation");
        break;
      case "switch_to_fallback_userscript":
        break;
      default:
        throw new BridgeError("INVALID_COMMAND", `Unknown recovery action ${action}`);
    }
  }

  async openSavedProperties() {
    await this.browser.gotoSavedListPage();
  }

  quotaSnapshot(): QuotaSnapshot {
    return this.quota.snapshot();
  }

  commandCost(command: CommandPayload): number {
    switch (command.command_type) {
      case "SAVE":
      case "SKIP_TRACE":
        return command.property_ids.length || 1;
      default:
        return 1;
    }
  }

  /**
   * Import a CSV file into PropStream as a marketing list.
   *
   * PropStream's import flow:
   * 1. Navigate to Marketing Lists page (/property/group/0)
   * 2. Click "Import" button
   * 3. Upload the CSV file via the file input
   * 4. Map columns (Address -> Address, City -> City, State -> State, Zip -> Zip)
   * 5. Name the list and submit
   *
   * Returns the number of records imported.
   */
  async importCsvToList(options: {
    csvPath: string;
    listName: string;
  }): Promise<{ imported: number; listName: string }> {
    await this.ensureReady();
    const page = await this.browser.getPage();

    // Navigate to Marketing Lists
    await this.browser.gotoSavedListPage();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);

    // Wait for the grid to fully load before attempting to click Import List.
    // The grid loading overlay can intercept clicks.
    const gridLoaded = Date.now();
    while (Date.now() - gridLoaded < 30_000) {
      const loadingVisible = await page.evaluate(`(function(){
        var text = document.body.innerText || "";
        return /loading/i.test(text.slice(0, 2000));
      })()`) as boolean;
      if (!loadingVisible) break;
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(2_000);
    await this.dismissBlockingOverlays(page).catch(() => undefined);
    this.logStep("import-csv:on-lists-page", { href: page.url() });
    await this.browser.screenshot("import-step1-lists-page").catch(() => undefined);

    // Click the "Import List" button. It's in the main toolbar area.
    // Use multiple click strategies and retry to handle timing issues.
    let importModalOpened = false;

    for (let attempt = 0; attempt < 3 && !importModalOpened; attempt++) {
      this.logStep("import-csv:click-attempt", { attempt });

      // Strategy: Find and click the Import List button using evaluate to
      // ensure we click the actual DOM element (not just at coordinates).
      await page.evaluate(`(function(){
        var all = document.querySelectorAll("div, span, button");
        for (var i = 0; i < all.length; i++) {
          var ownText = "";
          for (var j = 0; j < all[i].childNodes.length; j++) {
            if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent;
          }
          ownText = ownText.trim();
          if (/^import\\s*list$/i.test(ownText)) {
            var el = all[i].closest("button") || all[i].closest("[class*='Button']") || all[i];
            el.click();
            return true;
          }
        }
        return false;
      })()`);

      this.logStep("import-csv:import-list-button-clicked", { attempt });

      // Wait for the Import Properties modal to appear
      const modalStarted = Date.now();
      while (Date.now() - modalStarted < 10_000) {
        const hasFileInput = await page.locator('input[type="file"]').count().catch(() => 0);
        if (hasFileInput > 0) {
          importModalOpened = true;
          this.logStep("import-csv:modal-detected-with-file-input");
          break;
        }
        // Also check for the modal text
        const hasImportModal = await page.evaluate(`(function(){
          var text = document.body.innerText || "";
          return /import properties|choose file|download template/i.test(text);
        })()`) as boolean;
        if (hasImportModal) {
          importModalOpened = true;
          this.logStep("import-csv:modal-detected-by-text");
          break;
        }
        await page.waitForTimeout(500);
      }

      if (!importModalOpened) {
        // Try coordinate-based click as fallback
        const importRect = await page.evaluate(`(function(){
          var all = document.querySelectorAll("div, span, button");
          for (var i = 0; i < all.length; i++) {
            var ownText = "";
            for (var j = 0; j < all[i].childNodes.length; j++) {
              if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent;
            }
            ownText = ownText.trim();
            if (/^import\\s*list$/i.test(ownText)) {
              var btn = all[i].closest("button") || all[i];
              var r = btn.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
              }
            }
          }
          return null;
        })()`) as { x: number; y: number } | null;

        if (importRect) {
          await page.mouse.click(importRect.x, importRect.y);
          this.logStep("import-csv:coordinate-click", importRect);
          await page.waitForTimeout(3_000);
        }
      }
    }

    await this.browser.screenshot("import-step2-after-import-click").catch(() => undefined);

    if (!importModalOpened) {
      // Last resort: check if file input appeared
      const hasFile = await page.locator('input[type="file"]').count().catch(() => 0);
      if (hasFile > 0) {
        importModalOpened = true;
      } else {
        throw new BridgeError("DOM_SELECTOR_MISSING", "Import Properties modal did not appear after clicking Import List");
      }
    }

    // The Import Properties modal should now be visible with a "Choose File" button
    // containing an input[type="file"] that accepts .csv, .xls, .xlsx files.
    // Wait for the file input to appear (modal may take time to render).
    let fileInputFound = false;
    const fileInputStarted = Date.now();
    while (Date.now() - fileInputStarted < 15_000) {
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(options.csvPath);
        fileInputFound = true;
        this.logStep("import-csv:file-uploaded-via-input");
        break;
      }
      await page.waitForTimeout(1_000);
    }

    if (!fileInputFound) {
      await this.browser.screenshot("import-csv-no-file-input").catch(() => undefined);
      throw new BridgeError("DOM_SELECTOR_MISSING", "Could not find file upload input on import page");
    }

    await page.waitForTimeout(3_000);
    await this.browser.screenshot("import-step3-after-upload").catch(() => undefined);

    // Column mapping step - PropStream shows a mapping UI after upload
    // We need to map: Address, City, State, Zip
    // Try clicking "Next" or "Continue" to proceed through steps
    for (let step = 0; step < 3; step++) {
      await this.dismissBlockingOverlays(page).catch(() => undefined);

      // Check if we're on a column mapping page
      const hasMapping = await page.evaluate(`(function(){
        var text = document.body.innerText || "";
        return /column map|map.*column|field map|match.*field|address.*city.*state/i.test(text);
      })()`) as boolean;

      if (hasMapping) {
        this.logStep("import-csv:mapping-page-detected");
        await this.browser.screenshot(`import-step4-mapping-${step}`).catch(() => undefined);

        // Try to auto-map columns - PropStream usually auto-detects Address/City/State/Zip
        // If dropdowns exist, try to select the right values
        await page.evaluate(`(function(){
          var selects = document.querySelectorAll("select");
          var mappings = { "address": "Address", "city": "City", "state": "State", "zip": "Zip" };
          for (var i = 0; i < selects.length; i++) {
            var label = "";
            var prev = selects[i].previousElementSibling;
            if (prev) label = (prev.textContent || "").trim().toLowerCase();
            var parent = selects[i].closest("div, tr, li");
            if (parent) {
              var parentText = (parent.textContent || "").toLowerCase();
              for (var key in mappings) {
                if (parentText.includes(key) || label.includes(key)) {
                  for (var j = 0; j < selects[i].options.length; j++) {
                    var optText = selects[i].options[j].text.toLowerCase();
                    if (optText.includes(key) || optText === mappings[key].toLowerCase()) {
                      selects[i].selectedIndex = j;
                      selects[i].dispatchEvent(new Event("change", { bubbles: true }));
                      break;
                    }
                  }
                }
              }
            }
          }
        })()`);
        this.logStep("import-csv:columns-mapped");
      }

      // Enter the list name if there's a name input
      const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="list" i], input[name*="name" i], input[name*="list" i]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.click();
        await nameInput.fill(options.listName);
        this.logStep("import-csv:list-name-entered", { listName: options.listName });
      }

      // Also try using the list chooser if present
      await this.chooseListIfPresent(page, options.listName).catch(() => undefined);

      // Click Next/Continue/Import/Submit
      const nextClicked =
        await this.clickVisibleButton(page, /^next$/i) ||
        await this.clickVisibleButton(page, /^continue$/i) ||
        await this.clickVisibleButton(page, /^import$/i) ||
        await this.clickVisibleButton(page, /^submit$/i) ||
        await this.clickVisibleButton(page, /^upload$/i) ||
        await this.clickVisibleButton(page, /^save$/i) ||
        await this.clickVisibleButton(page, /^done$/i) ||
        await this.clickVisibleButton(page, /^finish$/i);

      if (nextClicked) {
        this.logStep("import-csv:next-clicked", { step });
        await page.waitForTimeout(3_000);
        await this.browser.screenshot(`import-step5-after-next-${step}`).catch(() => undefined);
      } else {
        break;
      }
    }

    // Wait for the "Add to Marketing List" Save button to become active.
    // PropStream shows a spinner on Save while processing the CSV. For large
    // files (3000+ addresses) this can take 60-120 seconds.
    const saveWaitStarted = Date.now();
    const maxSaveWaitMs = 180_000;
    let saveClicked = false;

    while (Date.now() - saveWaitStarted < maxSaveWaitMs) {
      // Check if the "Add to Marketing List" dialog is visible
      const hasMarketingListDialog = await page.evaluate(`(function(){
        var text = document.body.innerText || "";
        return /add to marketing list/i.test(text);
      })()`) as boolean;

      if (!hasMarketingListDialog) {
        // Dialog dismissed — import may have completed
        break;
      }

      // Enter list name if the input is visible but empty
      const nameInputStill = page.locator('input[placeholder*="name" i], input[placeholder*="list" i], input[role="combobox"]').first();
      if (await nameInputStill.isVisible().catch(() => false)) {
        const currentVal = await nameInputStill.inputValue().catch(() => "");
        if (!currentVal || currentVal !== options.listName) {
          await nameInputStill.click().catch(() => undefined);
          await nameInputStill.fill(options.listName).catch(() => undefined);
        }
      }

      // Check if Save button is active (no spinner/loading)
      const saveButtonState = await page.evaluate(`(function(){
        var buttons = document.querySelectorAll("button, [role='button']");
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || "").trim();
          if (/^save$/i.test(text)) {
            var disabled = buttons[i].disabled || buttons[i].getAttribute("disabled") !== null;
            var hasSpinner = buttons[i].querySelector("svg, .spinner, [class*='spin'], [class*='load']") !== null;
            var opacity = window.getComputedStyle(buttons[i]).opacity;
            return { found: true, disabled: disabled, hasSpinner: hasSpinner, opacity: opacity };
          }
        }
        return { found: false };
      })()`) as { found: boolean; disabled?: boolean; hasSpinner?: boolean; opacity?: string };

      if (saveButtonState.found && !saveButtonState.disabled && !saveButtonState.hasSpinner && saveButtonState.opacity !== "0.5") {
        this.logStep("import-csv:save-button-active", saveButtonState);
        await this.clickVisibleButton(page, /^save$/i);
        saveClicked = true;
        this.logStep("import-csv:save-clicked");
        await page.waitForTimeout(5_000);
        break;
      }

      this.logStep("import-csv:waiting-for-save", {
        elapsed: Math.round((Date.now() - saveWaitStarted) / 1000),
        saveState: saveButtonState,
      });
      await page.waitForTimeout(5_000);
    }

    if (!saveClicked) {
      // Final attempt — force-click Save regardless of state
      const forceClicked = await this.clickVisibleButton(page, /^save$/i);
      this.logStep("import-csv:force-save-attempt", { clicked: forceClicked });
      await page.waitForTimeout(10_000);
    }

    await this.dismissBlockingOverlays(page).catch(() => undefined);
    await this.browser.screenshot("import-step6-complete").catch(() => undefined);

    // Check for success indicators
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const successMatch = bodyText.match(/(\d[\d,]*)\s*(?:records?|properties|rows?|contacts?)\s*(?:imported|added|uploaded|processed|matched|found)/i);
    const imported = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;

    this.logStep("import-csv:complete", {
      listName: options.listName,
      imported,
      url: page.url(),
      saveClicked,
    });

    // Accept any confirmation dialogs
    await this.clickByText(page, /^ok$/i).catch(() => undefined);
    await this.clickByText(page, /^close$/i).catch(() => undefined);
    await this.clickByText(page, /^done$/i).catch(() => undefined);

    return { imported, listName: options.listName };
  }
}
