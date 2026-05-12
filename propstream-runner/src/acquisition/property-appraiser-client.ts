import type { Page } from "playwright";
import type { BrowserSession } from "../browser/session.js";

export interface PropertyMatch {
  ownerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  apn: string;
  assessedValue: number | null;
  marketValue: number | null;
  legalDescription: string;
  matchConfidence: "high" | "medium" | "low";
}

interface CountyAppraiserConfig {
  county: string;
  state: string;
  type: "devnet-wedge";
  baseUrl: string;
}

const COUNTY_APPRAISERS: CountyAppraiserConfig[] = [
  {
    county: "Greene",
    state: "MO",
    type: "devnet-wedge",
    baseUrl: "https://greenemo.devnetwedge.com",
  },
];

function normalizeNameForSearch(name: string): string {
  return name
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatchScore(searchName: string, foundName: string): "high" | "medium" | "low" {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

  const a = normalize(searchName);
  const b = normalize(foundName);

  if (a === b) return "high";

  const aParts = a.split(" ");
  const bParts = b.split(" ");

  const lastA = aParts[aParts.length - 1];
  const lastB = bParts[bParts.length - 1];
  if (lastA !== lastB) return "low";

  const firstA = aParts[0];
  const firstB = bParts[0];
  if (firstA === firstB) return "high";
  if (firstB.startsWith(firstA) || firstA.startsWith(firstB)) return "medium";

  return "low";
}

export class PropertyAppraiserClient {
  constructor(private readonly browser: BrowserSession) {}

  private log(step: string, extra?: Record<string, unknown>) {
    const payload = extra ? ` ${JSON.stringify(extra)}` : "";
    console.log(`[appraiser] ${step}${payload}`);
  }

  getAppraiserConfig(county: string, state: string): CountyAppraiserConfig | null {
    return (
      COUNTY_APPRAISERS.find(
        (a) =>
          a.county.toLowerCase() === county.toLowerCase() &&
          a.state.toLowerCase() === state.toLowerCase(),
      ) || null
    );
  }

  async searchByOwnerName(
    name: string,
    county: string,
    state: string,
  ): Promise<PropertyMatch[]> {
    const config = this.getAppraiserConfig(county, state);
    if (!config) {
      this.log("no appraiser configured", { county, state });
      return [];
    }

    if (config.type === "devnet-wedge") {
      return this.searchDevnetWedge(name, config);
    }

    return [];
  }

  private async searchDevnetWedge(
    name: string,
    config: CountyAppraiserConfig,
  ): Promise<PropertyMatch[]> {
    const page = await this.browser.getPage();
    const searchName = normalizeNameForSearch(name);

    this.log("searching devnet wedge", { name: searchName, county: config.county });

    const searchUrl = `${config.baseUrl}/parcel/view/all/novalue/1/Ession?Term=${encodeURIComponent(searchName)}&SearchField=Owner`;

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(2_000);

    const results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr, .parcel-row, [class*='result'] tr"));
      const matches: Array<{
        ownerName: string;
        address: string;
        apn: string;
        detailUrl: string;
      }> = [];

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 3) continue;

        const texts = cells.map((c) => c.textContent?.trim() || "");
        const link = row.querySelector("a");
        const href = link?.getAttribute("href") || "";

        const apnText = texts.find((t) => /^\d{2}-\d+-\d+-\d+/.test(t)) || texts[0] || "";
        const ownerText = texts.find((t) => /[A-Z]{2,}/.test(t) && !/^\d/.test(t)) || texts[1] || "";
        const addrText = texts.find((t) => /\d+\s+\w+/.test(t) && t !== apnText) || texts[2] || "";

        if (ownerText && ownerText.length > 2) {
          matches.push({
            ownerName: ownerText,
            address: addrText,
            apn: apnText,
            detailUrl: href,
          });
        }
      }

      return matches;
    });

    if (results.length === 0) {
      this.log("no results from devnet wedge");
      return [];
    }

    this.log("found parcel results", { count: results.length });

    const properties: PropertyMatch[] = [];

    for (const result of results.slice(0, 5)) {
      const confidence = nameMatchScore(searchName, result.ownerName);
      if (confidence === "low") continue;

      let assessed: number | null = null;
      let market: number | null = null;
      let legal = "";
      let city = "";
      let zip = "";

      if (result.detailUrl) {
        try {
          const detailHref = result.detailUrl.startsWith("http")
            ? result.detailUrl
            : `${config.baseUrl}${result.detailUrl.startsWith("/") ? "" : "/"}${result.detailUrl}`;

          await page.goto(detailHref, { waitUntil: "domcontentloaded", timeout: 15_000 });
          await page.waitForTimeout(1_000);

          const detail = await page.evaluate(() => {
            const body = document.body?.innerText || "";
            const assessed =
              body.match(/(?:Assessed|Appraised)\s*(?:Value)?[:\s]*\$?([\d,]+)/i)?.[1] || "";
            const market =
              body.match(/(?:Market|Fair\s*Market)\s*(?:Value)?[:\s]*\$?([\d,]+)/i)?.[1] || "";
            const legal =
              body.match(/(?:Legal|Legal\s*Description)[:\s]*(.+?)(?:\n|$)/i)?.[1]?.trim() || "";
            const cityMatch =
              body.match(/(?:City|Municipality)[:\s]*([A-Za-z\s]+?)(?:\n|,|$)/i)?.[1]?.trim() || "";
            const zipMatch = body.match(/\b(\d{5}(?:-\d{4})?)\b/)?.[1] || "";
            return { assessed, market, legal, city: cityMatch, zip: zipMatch };
          });

          assessed = detail.assessed ? parseInt(detail.assessed.replace(/,/g, ""), 10) : null;
          market = detail.market ? parseInt(detail.market.replace(/,/g, ""), 10) : null;
          legal = detail.legal;
          city = detail.city;
          zip = detail.zip;
        } catch {
          this.log("failed to fetch parcel detail", { apn: result.apn });
        }
      }

      properties.push({
        ownerName: result.ownerName,
        address: result.address,
        city,
        state: config.state,
        zip,
        apn: result.apn,
        assessedValue: assessed,
        marketValue: market,
        legalDescription: legal,
        matchConfidence: confidence,
      });
    }

    return properties;
  }
}
