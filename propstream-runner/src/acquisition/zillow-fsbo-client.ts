import type { Page } from "playwright";
import type { BrowserSession } from "../browser/session.js";

export interface ZillowListing {
  address: string;
  city: string;
  state: string;
  zip: string;
  zillow_url: string;
  asking_price: number | null;
  original_price: number | null;
  zestimate: number | null;
  days_on_market: number | null;
  price_drops: number;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  photo_count: number | null;
  description: string;
}

export class ZillowFsboClient {
  private page: Page | null = null;

  constructor(private readonly browser: BrowserSession) {}

  async init(): Promise<void> {
    this.page = await this.browser.start({ headed: true });
  }

  /**
   * Navigate to a Zillow page and wait for it to be ready.
   * If Zillow shows a captcha/challenge, log and wait for manual solving.
   */
  async waitForZillowReady(url: string): Promise<void> {
    const page = this.page!;
    console.log(`[zillow] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Check for captcha/challenge page
    const maxWait = 120_000; // 2 minutes for manual captcha solving
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const title = await page.title();
      const url_now = page.url();

      // Zillow captcha indicators
      const isCaptcha = title.toLowerCase().includes("access denied") ||
        title.toLowerCase().includes("captcha") ||
        title.toLowerCase().includes("verify") ||
        title.toLowerCase().includes("blocked") ||
        url_now.includes("captcha") ||
        url_now.includes("challenge");

      if (!isCaptcha) {
        // Check if we have actual search results
        const hasResults = await page.locator('[data-test="property-card"], article[data-test="property-card"], .property-card-data, .StyledPropertyCardDataWrapper').first().isVisible().catch(() => false);
        const hasNoResults = await page.locator('text=/0 results/i').isVisible().catch(() => false);

        if (hasResults || hasNoResults) {
          console.log(`[zillow] Page ready`);
          return;
        }

        // Also check for __NEXT_DATA__ with search results
        const hasNextData = await page.evaluate(() => {
          const el = document.getElementById("__NEXT_DATA__");
          if (!el) return false;
          try {
            const data = JSON.parse(el.textContent || "");
            return !!data?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults;
          } catch { return false; }
        }).catch(() => false);

        if (hasNextData) {
          console.log(`[zillow] Page ready (via __NEXT_DATA__)`);
          return;
        }
      } else {
        console.log(`[zillow] Challenge/captcha detected — please solve it manually in the browser window`);
      }

      await page.waitForTimeout(2_000);
    }

    // Even if we didn't detect results, proceed and try to scrape
    console.log(`[zillow] Proceeding after wait — page may or may not have results`);
  }

  /**
   * Extract listings from the current page using __NEXT_DATA__ JSON.
   */
  private async extractFromNextData(): Promise<ZillowListing[]> {
    const page = this.page!;

    const raw = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      try {
        return JSON.parse(el.textContent || "");
      } catch { return null; }
    });

    if (!raw) return [];

    // Navigate the Zillow __NEXT_DATA__ structure
    const searchResults =
      raw?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults ||
      raw?.props?.pageProps?.searchPageState?.cat1?.searchResults?.mapResults ||
      [];

    const listings: ZillowListing[] = [];

    for (const result of searchResults) {
      try {
        const hdp = result.hdpData?.homeInfo || result;

        // Parse address
        const addressParts = (result.address || hdp.streetAddress || "").split(", ");
        const street = addressParts[0] || "";
        const city = hdp.city || addressParts[1] || "";
        const stateZip = (addressParts[2] || "").split(" ");
        const state = hdp.state || stateZip[0] || "";
        const zip = hdp.zipcode || stateZip[1] || "";

        if (!street) continue;

        const listing: ZillowListing = {
          address: street,
          city,
          state,
          zip,
          zillow_url: result.detailUrl
            ? (result.detailUrl.startsWith("http") ? result.detailUrl : `https://www.zillow.com${result.detailUrl}`)
            : "",
          asking_price: hdp.price ?? result.price ?? result.unformattedPrice ?? null,
          original_price: null, // Not available in search results
          zestimate: hdp.zestimate ?? result.zestimate ?? null,
          days_on_market: hdp.daysOnZillow ?? result.timeOnZillow?.value ?? null,
          price_drops: 0,
          bedrooms: hdp.bedrooms ?? result.beds ?? null,
          bathrooms: hdp.bathrooms ?? result.baths ?? null,
          sqft: hdp.livingArea ?? result.area ?? null,
          lot_sqft: hdp.lotAreaValue ?? null,
          year_built: hdp.yearBuilt ?? null,
          photo_count: result.carouselPhotos?.length ?? result.photos?.length ?? null,
          description: "",
        };

        // Check for price reduction indicators
        if (result.variableData?.text?.includes("Price cut") || result.pgapt === "ForSale") {
          listing.price_drops = 1;
        }

        listings.push(listing);
      } catch {
        // Skip malformed entries
      }
    }

    return listings;
  }

  /**
   * Extract listings from DOM elements as fallback.
   */
  private async extractFromDom(): Promise<ZillowListing[]> {
    const page = this.page!;

    const listings: ZillowListing[] = [];
    const cards = await page.locator('article[data-test="property-card"], [data-test="property-card"], li[class*="ListItem"]').all();

    for (const card of cards) {
      try {
        const addressEl = await card.locator('address, [data-test="property-card-addr"]').first().textContent().catch(() => null);
        if (!addressEl) continue;

        const priceText = await card.locator('[data-test="property-card-price"], span[class*="PropertyCardWrapper__StyledPriceLine"]').first().textContent().catch(() => null);
        const price = priceText ? parseInt(priceText.replace(/[^0-9]/g, ""), 10) || null : null;

        const detailsText = await card.locator('[data-test="property-card-details"], ul[class*="StyledPropertyCardHomeDetails"]').first().textContent().catch(() => "");

        const bedsMatch = detailsText?.match(/(\d+)\s*(?:bd|bed)/i);
        const bathsMatch = detailsText?.match(/([\d.]+)\s*(?:ba|bath)/i);
        const sqftMatch = detailsText?.match(/([\d,]+)\s*sqft/i);

        const linkEl = await card.locator('a[href*="/homedetails/"]').first().getAttribute("href").catch(() => null);

        // Parse address string "123 Main St, City, ST ZIP"
        const parts = (addressEl || "").split(", ");
        const street = parts[0] || "";
        const city = parts[1] || "";
        const stateZip = (parts[2] || "").split(" ");

        listings.push({
          address: street.trim(),
          city: city.trim(),
          state: stateZip[0]?.trim() || "",
          zip: stateZip[1]?.trim() || "",
          zillow_url: linkEl ? (linkEl.startsWith("http") ? linkEl : `https://www.zillow.com${linkEl}`) : "",
          asking_price: price,
          original_price: null,
          zestimate: null,
          days_on_market: null,
          price_drops: 0,
          bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
          bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
          sqft: sqftMatch ? parseInt(sqftMatch[1].replace(",", "")) : null,
          lot_sqft: null,
          year_built: null,
          photo_count: null,
          description: "",
        });
      } catch {
        // Skip problematic cards
      }
    }

    return listings;
  }

  /**
   * Check if there's a next page and navigate to it.
   * Returns false if no more pages.
   */
  private async goToNextPage(): Promise<boolean> {
    const page = this.page!;

    // Look for Zillow's next page button
    const nextBtn = page.locator('a[title="Next page"], a[rel="next"], [aria-label="Next page"]').first();
    const isVisible = await nextBtn.isVisible().catch(() => false);

    if (!isVisible) return false;

    const isDisabled = await nextBtn.getAttribute("disabled").catch(() => null);
    if (isDisabled !== null) return false;

    const href = await nextBtn.getAttribute("href").catch(() => null);
    if (!href) return false;

    console.log(`[zillow] Navigating to next page...`);
    await nextBtn.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_000 + Math.random() * 2_000);

    return true;
  }

  /**
   * Enrich a listing by visiting its detail page for description and price history.
   */
  async enrichListing(listing: ZillowListing): Promise<ZillowListing> {
    if (!listing.zillow_url) return listing;
    const page = this.page!;

    try {
      await page.goto(listing.zillow_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1_500 + Math.random() * 1_000);

      // Get description
      const desc = await page.locator('[data-testid="description-text"], [class*="Description"]').first().textContent().catch(() => null);
      if (desc) listing.description = desc.trim().slice(0, 2000);

      // Get price history for original price and price drops
      const priceHistory = await page.evaluate(() => {
        // Zillow price history is often in __NEXT_DATA__
        const el = document.getElementById("__NEXT_DATA__");
        if (!el) return null;
        try {
          const data = JSON.parse(el.textContent || "");
          const property = data?.props?.pageProps?.componentProps?.gdpClientCache;
          if (!property) return null;
          // gdpClientCache is keyed by zpid
          const key = Object.keys(property)[0];
          if (!key) return null;
          const cache = JSON.parse(property[key]);
          return cache?.property?.priceHistory || null;
        } catch { return null; }
      }).catch(() => null);

      if (priceHistory && Array.isArray(priceHistory)) {
        const priceChanges = priceHistory.filter((e: any) =>
          e.event === "Price change" || e.event === "Listed for sale"
        );

        if (priceChanges.length > 0) {
          // Original price = first listed price
          const listedEvents = priceChanges.filter((e: any) => e.event === "Listed for sale");
          if (listedEvents.length > 0 && listedEvents[0].price) {
            listing.original_price = listedEvents[0].price;
          }

          // Count price drops
          listing.price_drops = priceChanges.filter((e: any) => e.event === "Price change" && e.priceChangeRate < 0).length;
        }
      }

      // Year built from detail page if missing
      if (!listing.year_built) {
        const yrText = await page.locator('text=/Built in \\d{4}/i').first().textContent().catch(() => null);
        if (yrText) {
          const m = yrText.match(/(\d{4})/);
          if (m) listing.year_built = parseInt(m[1]);
        }
      }

      // Lot size from detail page if missing
      if (!listing.lot_sqft) {
        const lotText = await page.locator('text=/Lot:\\s*[\\d,]+/i, text=/lot size/i').first().textContent().catch(() => null);
        if (lotText) {
          const m = lotText.match(/([\d,]+)\s*(?:sq|sqft)/i);
          if (m) listing.lot_sqft = parseInt(m[1].replace(",", ""));
        }
      }
    } catch (err) {
      console.log(`[zillow] Could not enrich ${listing.address}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return listing;
  }

  /**
   * Scrape all FSBO listings for a given market URL.
   * Returns all listings found across all pages.
   */
  async scrapeMarket(searchUrl: string, opts?: { enrichDetail?: boolean; maxPages?: number }): Promise<ZillowListing[]> {
    const maxPages = opts?.maxPages ?? 10;
    const enrichDetail = opts?.enrichDetail ?? false;

    await this.waitForZillowReady(searchUrl);

    const allListings: ZillowListing[] = [];
    let pageNum = 1;

    while (pageNum <= maxPages) {
      console.log(`[zillow] Scraping page ${pageNum}...`);

      // Try __NEXT_DATA__ first, fall back to DOM
      let listings = await this.extractFromNextData();
      if (listings.length === 0) {
        console.log(`[zillow] __NEXT_DATA__ empty, trying DOM extraction...`);
        listings = await this.extractFromDom();
      }

      console.log(`[zillow] Page ${pageNum}: found ${listings.length} listings`);
      if (listings.length === 0) break;

      allListings.push(...listings);

      // Check for next page
      const hasNext = await this.goToNextPage();
      if (!hasNext) break;
      pageNum++;
    }

    // Optionally enrich each listing with detail page data
    if (enrichDetail && allListings.length > 0) {
      console.log(`[zillow] Enriching ${allListings.length} listings with detail data...`);
      for (let i = 0; i < allListings.length; i++) {
        console.log(`[zillow] Enriching ${i + 1}/${allListings.length}: ${allListings[i].address}`);
        allListings[i] = await this.enrichListing(allListings[i]);
        // Rate limit between detail page visits
        await this.page!.waitForTimeout(2_000 + Math.random() * 3_000);
      }
    }

    console.log(`[zillow] Market complete: ${allListings.length} total listings`);
    return allListings;
  }
}
