import type { Page } from "playwright";
import type { BrowserSession } from "../browser/session.js";
import type { RunnerConfig } from "../config.js";

export interface CaseParty {
  name: string;
  role: string;
  address: string | null;
}

export interface DocketEntry {
  date: string;
  description: string;
  documentUrl: string | null;
}

export interface CaseRecord {
  caseNumber: string;
  courtId: string;
  county: string;
  caseType: string;
  fileDate: string;
  caseTitle: string;
  deceasedName: string | null;
  personalRepresentative: {
    name: string;
    address: string | null;
    role: string;
  } | null;
  parties: CaseParty[];
  docketEntries: DocketEntry[];
  caseUrl: string;
}

interface FilingDateSearchParams {
  courtId: string;
  caseType: "Probate" | "Civil" | "All";
  startDate: string;
  endDate: string;
}

const CASENET_BASE = "https://www.courts.mo.gov";

const CASE_TYPE_MAP: Record<string, string> = {
  Probate: "Probate",
  Civil: "Civil",
  All: "All",
};

const DECEASED_PATTERN = /(?:Estate\s+of|In\s+(?:the\s+)?(?:Estate|Matter)\s+of)\s+(.+?)(?:,\s*(?:Deceased|Dec['']?d|a\s+deceased)|\s*$)/i;

const PR_ROLES = [
  "personal representative",
  "administrator",
  "executor",
  "executrix",
  "administratrix",
  "petitioner",
];

export class CaseNetClient {
  constructor(
    private readonly browser: BrowserSession,
    private readonly config: RunnerConfig,
  ) {}

  private log(step: string, extra?: Record<string, unknown>) {
    const payload = extra ? ` ${JSON.stringify(extra)}` : "";
    console.log(`[casenet] ${step}${payload}`);
  }

  async waitForCaseNetReady(): Promise<void> {
    const page = await this.browser.start({ headed: true });
    const caseNetUrl = `${this.config.caseNetBaseUrl || CASENET_BASE + "/cnet"}/filingDateSearch.do`;

    this.log("navigating to Case.net filing date search");
    await page.goto(caseNetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.bringToFront();

    const startedAt = Date.now();
    const timeoutMs = 5 * 60_000;

    while (Date.now() - startedAt < timeoutMs) {
      const state = await page.evaluate(() => ({
        href: window.location.href,
        title: document.title || "",
        hasForm: Boolean(
          document.querySelector("select[name='courtId']") ||
          document.querySelector("select[name*='courtId']") ||
          document.querySelector("form[name*='filingDate']") ||
          document.querySelector("input[name='inputVO.startDate']")
        ),
        hasCloudflareChallenge: Boolean(
          document.querySelector("script[src*='challenge-platform']") ||
          document.querySelector("#cf-wrapper") ||
          document.querySelector("[class*='cf-browser-verification']")
        ),
        bodyText: (document.body?.innerText || "").slice(0, 500),
      })).catch(() => null);

      if (state?.hasForm) {
        this.log("case.net ready — filing date search form detected");
        return;
      }

      if (state?.hasCloudflareChallenge) {
        this.log("waiting for user to pass Cloudflare challenge...");
      }

      await page.waitForTimeout(2_000);
    }

    throw new Error("Timed out waiting for Case.net to be ready. Please pass the Cloudflare challenge in the browser window.");
  }

  async searchByFilingDate(params: FilingDateSearchParams): Promise<CaseRecord[]> {
    const page = await this.browser.getPage();
    const caseNetBase = this.config.caseNetBaseUrl || CASENET_BASE + "/cnet";

    this.log("submitting filing date search", {
      courtId: params.courtId,
      caseType: params.caseType,
      startDate: params.startDate,
      endDate: params.endDate,
    });

    await page.goto(`${caseNetBase}/filingDateSearch.do?newSearch=Y`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.waitForSelector("select[name='courtId']", { timeout: 15_000 });

    await page.selectOption("select[name='courtId']", { value: params.courtId }).catch(async () => {
      const options = await page.$$eval("select[name='courtId'] option", (opts) =>
        opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent?.trim() || "" })),
      );
      const match = options.find((o) => o.text.toLowerCase().includes(params.courtId.toLowerCase()));
      if (match) await page.selectOption("select[name='courtId']", { value: match.value });
    });

    await page.waitForTimeout(1_500);

    const startDateInput = await page.$("input[name='inputVO.startDate']");
    if (startDateInput) {
      await startDateInput.fill(params.startDate);
    }

    const caseTypeSelect = await page.$("select[name='inputVO.caseType']");
    if (caseTypeSelect) {
      const caseTypeLabel = CASE_TYPE_MAP[params.caseType] || params.caseType;
      await caseTypeSelect.selectOption({ value: caseTypeLabel }).catch(async () => {
        await caseTypeSelect.selectOption({ label: caseTypeLabel });
      });
    }

    await page.waitForTimeout(500);

    const searchBtn = await page.$("input[type='submit'][name='search'], input[type='submit'][value*='Search'], button[type='submit']");
    if (searchBtn) {
      await searchBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(3_000);

    const caseLinks = await this.extractCaseLinksFromResults(page);
    this.log("found case links", { count: caseLinks.length });

    const cases: CaseRecord[] = [];

    for (let i = 0; i < caseLinks.length; i++) {
      const link = caseLinks[i];
      this.log(`processing case ${i + 1}/${caseLinks.length}`, { caseNumber: link.caseNumber });

      try {
        const detail = await this.getCaseDetail(page, link.href, link.caseNumber, params.courtId);
        if (detail) {
          detail.county = params.courtId;
          cases.push(detail);
        }
      } catch (error) {
        this.log(`failed to process case ${link.caseNumber}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await page.waitForTimeout(2_000 + Math.random() * 1_000);
    }

    return cases;
  }

  private async extractCaseLinksFromResults(page: Page): Promise<Array<{ caseNumber: string; href: string; title: string }>> {
    await page.waitForTimeout(2_000);

    const links = await page.$$eval("a[href*='header.do'], a[href*='caseNumber']", (anchors) =>
      anchors.map((a) => ({
        href: a.getAttribute("href") || "",
        text: a.textContent?.trim() || "",
      })),
    ).catch(() => []);

    if (links.length > 0) {
      return links.map((l) => ({
        caseNumber: l.text,
        href: l.href.startsWith("http") ? l.href : `${CASENET_BASE}${l.href.startsWith("/") ? "" : "/"}${l.href}`,
        title: l.text,
      }));
    }

    const tableLinks = await page.$$eval("table a, .case-list a, td a", (anchors) =>
      anchors
        .filter((a) => {
          const text = a.textContent?.trim() || "";
          return /^\d{2}[A-Z]{2}-[A-Z]{2}\d+/.test(text) || /case/i.test(a.getAttribute("href") || "");
        })
        .map((a) => ({
          href: a.getAttribute("href") || "",
          text: a.textContent?.trim() || "",
        })),
    ).catch(() => []);

    return tableLinks.map((l) => ({
      caseNumber: l.text,
      href: l.href.startsWith("http") ? l.href : `${CASENET_BASE}${l.href.startsWith("/") ? "" : "/"}${l.href}`,
      title: l.text,
    }));
  }

  private async getCaseDetail(
    page: Page,
    caseUrl: string,
    caseNumber: string,
    courtId: string,
  ): Promise<CaseRecord | null> {
    const fullUrl = caseUrl.startsWith("http") ? caseUrl : `${CASENET_BASE}${caseUrl}`;
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1_500);

    const headerInfo = await page.evaluate(() => {
      const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() || "";
      const title = document.title || "";
      const bodyText = document.body?.innerText || "";
      return { title, bodyText: bodyText.slice(0, 5000) };
    });

    const caseTitle = this.extractCaseTitle(headerInfo.title, headerInfo.bodyText);
    const fileDate = this.extractFileDate(headerInfo.bodyText);
    const deceasedName = this.parseDeceasedName(caseTitle);

    const partiesUrl = fullUrl.replace(/header\.do/, "parties.do");
    let parties: CaseParty[] = [];
    try {
      await page.goto(partiesUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1_000);
      parties = await this.extractParties(page);
    } catch {
      parties = this.extractPartiesFromText(headerInfo.bodyText);
    }

    const pr = this.findPersonalRepresentative(parties);

    let docketEntries: DocketEntry[] = [];
    const docketsUrl = fullUrl.replace(/header\.do/, "dockets.do");
    try {
      await page.goto(docketsUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1_000);
      docketEntries = await this.extractDocketEntries(page);
    } catch {}

    return {
      caseNumber,
      courtId,
      county: "",
      caseType: "Probate",
      fileDate: fileDate || "",
      caseTitle,
      deceasedName,
      personalRepresentative: pr,
      parties,
      docketEntries,
      caseUrl: fullUrl,
    };
  }

  private extractCaseTitle(pageTitle: string, bodyText: string): string {
    const estateMatch = bodyText.match(/(?:Style|Case\s*Title|Caption)[:\s]*(.+?)(?:\n|$)/i);
    if (estateMatch) return estateMatch[1].trim();

    const titleMatch = pageTitle.match(/(?:Estate\s+of|In\s+(?:the\s+)?(?:Estate|Matter)\s+of).+/i);
    if (titleMatch) return titleMatch[0].trim();

    const bodyEstateMatch = bodyText.match(/((?:Estate\s+of|In\s+(?:the\s+)?(?:Estate|Matter)\s+of)\s+.+?)(?:\n|Filing|Case\s*(?:Number|No))/i);
    if (bodyEstateMatch) return bodyEstateMatch[1].trim();

    return pageTitle;
  }

  private extractFileDate(bodyText: string): string | null {
    const match = bodyText.match(/(?:File\s*Date|Filing\s*Date|Date\s*Filed)[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    return match ? match[1] : null;
  }

  parseDeceasedName(caseTitle: string): string | null {
    const match = caseTitle.match(DECEASED_PATTERN);
    if (match) return match[1].replace(/\s+/g, " ").trim();
    const simpleMatch = caseTitle.match(/Estate\s+of\s+(.+)/i);
    if (simpleMatch) return simpleMatch[1].replace(/,?\s*Deceased.*$/i, "").replace(/\s+/g, " ").trim();
    return null;
  }

  private async extractParties(page: Page): Promise<CaseParty[]> {
    return page.evaluate(() => {
      const parties: Array<{ name: string; role: string; address: string | null }> = [];
      const rows = Array.from(document.querySelectorAll("table tr, .party-row, [class*='party']"));

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td, span, div"));
        if (cells.length < 2) continue;

        const texts = Array.from(cells).map((c) => c.textContent?.trim() || "");
        const nameCell = texts.find((t) => t.length > 2 && !/^\d/.test(t) && !/date|case|court/i.test(t));
        const roleCell = texts.find((t) =>
          /personal\s*rep|administrator|executor|petitioner|respondent|deceased|attorney/i.test(t),
        );

        if (nameCell && roleCell) {
          const addrMatch = texts.find((t) => /\d+\s+\w+\s+(st|ave|rd|dr|blvd|ln|ct|way|pl)/i.test(t));
          parties.push({
            name: nameCell,
            role: roleCell,
            address: addrMatch || null,
          });
        }
      }

      if (parties.length === 0) {
        const bodyText = document.body?.innerText || "";
        const sections = bodyText.split(/\n{2,}/);
        for (const section of sections) {
          const roleMatch = section.match(/(Personal\s*Representative|Administrator|Executor|Petitioner|Respondent|Deceased)/i);
          if (roleMatch) {
            const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
            const nameLine = lines.find((l) => l !== roleMatch[0] && l.length > 2 && !/date|case|court|address/i.test(l));
            if (nameLine) {
              const addrLine = lines.find((l) => /\d+\s+\w+\s+(st|ave|rd|dr|blvd|ln|ct|way|pl)/i.test(l));
              parties.push({
                name: nameLine,
                role: roleMatch[1],
                address: addrLine || null,
              });
            }
          }
        }
      }

      return parties;
    });
  }

  private extractPartiesFromText(bodyText: string): CaseParty[] {
    const parties: CaseParty[] = [];
    const prMatch = bodyText.match(/(?:Personal\s*Representative|Administrator|Executor)[:\s]*([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)/i);
    if (prMatch) {
      parties.push({ name: prMatch[1].trim(), role: "Personal Representative", address: null });
    }
    const decMatch = bodyText.match(/(?:Deceased|Decedent)[:\s]*([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)/i);
    if (decMatch) {
      parties.push({ name: decMatch[1].trim(), role: "Deceased", address: null });
    }
    return parties;
  }

  private findPersonalRepresentative(parties: CaseParty[]): CaseRecord["personalRepresentative"] {
    for (const party of parties) {
      const roleLower = party.role.toLowerCase();
      if (PR_ROLES.some((r) => roleLower.includes(r))) {
        return {
          name: party.name,
          address: party.address,
          role: party.role,
        };
      }
    }
    const petitioner = parties.find((p) => /petitioner/i.test(p.role));
    if (petitioner) {
      return { name: petitioner.name, address: petitioner.address, role: petitioner.role };
    }
    return null;
  }

  private async extractDocketEntries(page: Page): Promise<DocketEntry[]> {
    return page.evaluate(() => {
      const entries: Array<{ date: string; description: string; documentUrl: string | null }> = [];
      const rows = Array.from(document.querySelectorAll("table tr"));

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 2) continue;

        const dateText = cells[0]?.textContent?.trim() || "";
        const descText = cells[1]?.textContent?.trim() || cells[cells.length - 1]?.textContent?.trim() || "";

        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(dateText)) {
          const link = row.querySelector("a[href*='document'], a[href*='docket']");
          entries.push({
            date: dateText,
            description: descText,
            documentUrl: link?.getAttribute("href") || null,
          });
        }
      }

      return entries;
    });
  }
}
