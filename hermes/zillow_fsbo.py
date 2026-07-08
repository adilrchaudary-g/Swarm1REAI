"""
Zillow FSBO Scraper — Playwright-based scraper for For Sale By Owner listings.

Scrapes Zillow FSBO listings for target markets, extracts property data,
and stacks distress signals by cross-referencing against existing lead data.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

# Zillow search URLs for FSBO listings by market
MARKET_URLS = {
    "cleveland-oh": "https://www.zillow.com/cleveland-oh/fsbo/",
    "columbus-oh": "https://www.zillow.com/columbus-oh/fsbo/",
    "cincinnati-oh": "https://www.zillow.com/cincinnati-oh/fsbo/",
    "detroit-mi": "https://www.zillow.com/detroit-mi/fsbo/",
    "atlanta-ga": "https://www.zillow.com/atlanta-ga/fsbo/",
    "houston-tx": "https://www.zillow.com/houston-tx/fsbo/",
    "dallas-tx": "https://www.zillow.com/dallas-tx/fsbo/",
    "san-antonio-tx": "https://www.zillow.com/san-antonio-tx/fsbo/",
    "chicago-il": "https://www.zillow.com/chicago-il/fsbo/",
    "baltimore-md": "https://www.zillow.com/baltimore-md/fsbo/",
    "memphis-tn": "https://www.zillow.com/memphis-tn/fsbo/",
    "jacksonville-fl": "https://www.zillow.com/jacksonville-fl/fsbo/",
    "tampa-fl": "https://www.zillow.com/tampa-fl/fsbo/",
    "birmingham-al": "https://www.zillow.com/birmingham-al/fsbo/",
    "indianapolis-in": "https://www.zillow.com/indianapolis-in/fsbo/",
    "st-louis-mo": "https://www.zillow.com/st-louis-mo/fsbo/",
    "milwaukee-wi": "https://www.zillow.com/milwaukee-wi/fsbo/",
    "kansas-city-mo": "https://www.zillow.com/kansas-city-mo/fsbo/",
    "buffalo-ny": "https://www.zillow.com/buffalo-ny/fsbo/",
    "pittsburgh-pa": "https://www.zillow.com/pittsburgh-pa/fsbo/",
}

# Price ceiling — we only want below-market properties
MAX_PRICE = 250_000

# Days on Zillow threshold — stale FSBO = more motivated
STALE_DAYS_THRESHOLD = 30


def _parse_price(text: str) -> int | None:
    """Extract numeric price from text like '$125,000' or '$89K'."""
    if not text:
        return None
    cleaned = re.sub(r'[^\d]', '', text.split('.')[0])
    if cleaned:
        val = int(cleaned)
        if val < 1000:
            val *= 1000
        return val
    return None


def _parse_address(card_text: str) -> dict[str, str]:
    """Parse address components from Zillow card text."""
    parts = card_text.strip().split(',')
    result: dict[str, str] = {}
    if len(parts) >= 1:
        result['street'] = parts[0].strip()
    if len(parts) >= 2:
        result['city'] = parts[1].strip()
    if len(parts) >= 3:
        state_zip = parts[2].strip().split()
        if state_zip:
            result['state'] = state_zip[0]
        if len(state_zip) > 1:
            result['zip'] = state_zip[1]
    return result


def _detect_distress_signals(listing: dict) -> list[str]:
    """Stack distress signals based on listing data."""
    signals = ['fsbo']

    price = listing.get('price', 0)
    zestimate = listing.get('zestimate', 0)

    if price and zestimate and price < zestimate * 0.85:
        signals.append('below_zestimate')

    days = listing.get('days_on_zillow', 0)
    if days and days > STALE_DAYS_THRESHOLD:
        signals.append('stale_listing')
    if days and days > 90:
        signals.append('very_stale')

    desc = (listing.get('description') or '').lower()
    distress_keywords = {
        'motivated': 'motivated_seller',
        'must sell': 'must_sell',
        'as-is': 'as_is',
        'as is': 'as_is',
        'handyman': 'handyman_special',
        'fixer': 'fixer_upper',
        'estate sale': 'estate_sale',
        'inherited': 'inherited',
        'foreclosure': 'pre_foreclosure',
        'behind on': 'delinquent',
        'needs work': 'needs_work',
        'investor': 'investor_special',
        'cash only': 'cash_only',
        'quick sale': 'quick_sale',
        'relocat': 'relocating',
        'divorce': 'divorce',
        'vacant': 'vacant',
    }
    for keyword, signal in distress_keywords.items():
        if keyword in desc:
            signals.append(signal)

    if price and price < 80_000:
        signals.append('ultra_low_price')

    return signals


def scrape_zillow_fsbo(
    markets: list[str] | None = None,
    max_pages: int = 3,
    headless: bool = False,
    log_fn: Any = print,
) -> list[dict]:
    """
    Scrape Zillow FSBO listings for specified markets.

    Args:
        markets: List of market keys (e.g. ['cleveland-oh']). None = all markets.
        max_pages: Max pages to scrape per market.
        headless: Run browser in headless mode (False = visible).
        log_fn: Callback for log messages.

    Returns:
        List of listing dicts with property data + distress signals.
    """
    from playwright.sync_api import sync_playwright

    target_markets = markets or list(MARKET_URLS.keys())
    all_listings: list[dict] = []

    log_fn(f"[zillow-fsbo] Starting scrape for {len(target_markets)} market(s)")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=['--disable-blink-features=AutomationControlled'],
        )
        context = browser.new_context(
            user_agent=(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/131.0.0.0 Safari/537.36'
            ),
            viewport={'width': 1280, 'height': 900},
        )
        # Stealth: remove webdriver flag
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)

        page = context.new_page()

        for market in target_markets:
            url = MARKET_URLS.get(market)
            if not url:
                log_fn(f"[zillow-fsbo] Unknown market: {market}")
                continue

            log_fn(f"[zillow-fsbo] Scraping {market}...")

            for page_num in range(1, max_pages + 1):
                page_url = url if page_num == 1 else f"{url}{page_num}_p/"
                log_fn(f"[zillow-fsbo]   Page {page_num}: {page_url}")

                try:
                    page.goto(page_url, wait_until='domcontentloaded', timeout=30000)
                    time.sleep(3)

                    # Screenshot for debugging
                    ss_path = str(Path(__file__).parent / "data" / "zillow_debug.png")
                    try:
                        page.screenshot(path=ss_path)
                        log_fn(f"[zillow-fsbo]   Screenshot saved: {ss_path}")
                    except Exception:
                        pass

                    # Handle CAPTCHA / access denied
                    page_text = page.content()
                    if 'captcha' in page_text.lower() or 'press & hold' in page_text.lower():
                        log_fn(f"[zillow-fsbo]   CAPTCHA / bot check detected — waiting 20s for manual solve")
                        time.sleep(20)
                        page_text = page.content()

                    if 'access denied' in page_text.lower():
                        log_fn(f"[zillow-fsbo]   Access denied — Zillow blocked this request")
                        break

                    # Try multiple selector strategies
                    card_found = False
                    selectors = [
                        'article[data-test="property-card"]',
                        '[id="grid-search-results"] li',
                        '[class*="StyledPropertyCard"]',
                        '[class*="property-card"]',
                        'ul[class*="photo-cards"] li',
                        '#search-page-list-container li',
                        'div[class*="ListItem"]',
                    ]
                    for sel in selectors:
                        try:
                            page.wait_for_selector(sel, timeout=5000)
                            card_found = True
                            log_fn(f"[zillow-fsbo]   Cards found with selector: {sel}")
                            break
                        except Exception:
                            continue

                    if not card_found:
                        log_fn(f"[zillow-fsbo]   No property cards found — trying JSON extraction anyway")

                    # Extract listings from search results JSON embedded in page
                    listings_on_page = _extract_listings_from_page(page, market, log_fn)
                    all_listings.extend(listings_on_page)
                    log_fn(f"[zillow-fsbo]   Found {len(listings_on_page)} listings on page {page_num}")

                    if len(listings_on_page) == 0:
                        log_fn(f"[zillow-fsbo]   No more results — moving to next market")
                        break

                    time.sleep(1.5 + (page_num * 0.5))

                except Exception as exc:
                    log_fn(f"[zillow-fsbo]   Error on page {page_num}: {exc}")
                    break

        browser.close()

    log_fn(f"[zillow-fsbo] Scrape complete: {len(all_listings)} total listings")
    return all_listings


def _extract_listings_from_page(page: Any, market: str, log_fn: Any) -> list[dict]:
    """Extract listing data from the current Zillow page."""
    listings = []

    # Method 1: Try to get data from __NEXT_DATA__ or search results JSON
    try:
        json_data = page.evaluate("""() => {
            // Try __NEXT_DATA__
            const nd = document.getElementById('__NEXT_DATA__');
            if (nd) {
                try {
                    const d = JSON.parse(nd.textContent);
                    const results = d?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults
                        || d?.props?.pageProps?.searchResults?.listResults;
                    if (results) return { source: 'next_data', results };
                } catch {}
            }
            // Try inline script with search results
            for (const script of document.querySelectorAll('script[type="application/json"]')) {
                try {
                    const d = JSON.parse(script.textContent);
                    if (d?.cat1?.searchResults?.listResults) {
                        return { source: 'app_json', results: d.cat1.searchResults.listResults };
                    }
                    if (d?.searchResults?.listResults) {
                        return { source: 'app_json', results: d.searchResults.listResults };
                    }
                } catch {}
            }
            // Try window.__ZDP_SEARCH__ or similar global
            try {
                const w = window;
                if (w.__ZDP_SEARCH__?.listResults) return { source: 'zdp', results: w.__ZDP_SEARCH__.listResults };
            } catch {}
            // Try scraping all script tags for listResults pattern
            for (const script of document.querySelectorAll('script')) {
                const text = script.textContent || '';
                if (text.includes('listResults') && text.includes('zpid')) {
                    try {
                        const match = text.match(/"listResults"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
                        if (match) return { source: 'regex', results: JSON.parse(match[1]) };
                    } catch {}
                }
            }
            return null;
        }""")

        if json_data and json_data.get('results'):
            log_fn(f"[zillow-fsbo]   Extracted via {json_data['source']}")
            for item in json_data['results']:
                listing = _normalize_json_listing(item, market)
                if listing:
                    listings.append(listing)
            return listings
    except Exception:
        pass

    # Method 2: DOM scraping fallback
    log_fn(f"[zillow-fsbo]   Falling back to DOM scraping")
    cards = page.query_selector_all(
        'article[data-test="property-card"], [class*="property-card"], li[class*="ListItem"]'
    )
    for card in cards:
        try:
            listing = _extract_from_card(card, market)
            if listing:
                listings.append(listing)
        except Exception:
            continue

    return listings


def _normalize_json_listing(item: dict, market: str) -> dict | None:
    """Normalize a listing from Zillow's JSON search results."""
    zpid = item.get('zpid') or item.get('id')
    address_raw = item.get('address') or item.get('addressStreet', '')
    if isinstance(address_raw, dict):
        street = address_raw.get('streetAddress', '')
        city = address_raw.get('city', '')
        state = address_raw.get('state', '')
        zipcode = address_raw.get('zipcode', '')
    else:
        parts = _parse_address(str(address_raw))
        street = parts.get('street', '')
        city = parts.get('city', '')
        state = parts.get('state', '')
        zipcode = parts.get('zip', '')

    price = item.get('price') or item.get('unformattedPrice')
    if isinstance(price, str):
        price = _parse_price(price)

    if price and price > MAX_PRICE:
        return None

    beds = item.get('beds') or item.get('bedrooms')
    baths = item.get('baths') or item.get('bathrooms')
    sqft = item.get('area') or item.get('livingArea')
    zestimate = item.get('zestimate') or item.get('hdpData', {}).get('homeInfo', {}).get('zestimate')
    days_on = item.get('variableData', {}).get('text', '')
    days_match = re.search(r'(\d+)\s*day', str(days_on), re.IGNORECASE)
    days_on_zillow = int(days_match.group(1)) if days_match else None

    listing_url = item.get('detailUrl') or ''
    if listing_url and not listing_url.startswith('http'):
        listing_url = f"https://www.zillow.com{listing_url}"

    listing = {
        'zpid': str(zpid) if zpid else None,
        'address_street': street,
        'address_city': city,
        'address_state': state,
        'address_zip': zipcode,
        'address_full': f"{street}, {city}, {state} {zipcode}".strip(', '),
        'price': price,
        'beds': beds,
        'baths': baths,
        'sqft': sqft,
        'zestimate': zestimate,
        'days_on_zillow': days_on_zillow,
        'listing_url': listing_url,
        'source': 'zillow_fsbo',
        'market': market,
        'property_type': item.get('hdpData', {}).get('homeInfo', {}).get('homeType', 'unknown'),
        'description': item.get('hdpData', {}).get('homeInfo', {}).get('description', ''),
    }

    listing['distress_signals'] = _detect_distress_signals(listing)
    return listing


def _extract_from_card(card: Any, market: str) -> dict | None:
    """Extract listing data from a DOM card element."""
    # Address
    addr_el = card.query_selector('[data-test="property-card-addr"], address, [class*="address"]')
    if not addr_el:
        return None
    addr_text = addr_el.inner_text().strip()
    parts = _parse_address(addr_text)

    # Price
    price_el = card.query_selector('[data-test="property-card-price"], [class*="price"]')
    price = _parse_price(price_el.inner_text()) if price_el else None
    if price and price > MAX_PRICE:
        return None

    # Beds/baths/sqft
    details_el = card.query_selector('[class*="property-card-data"], [class*="StyledPropertyCardDataArea"]')
    beds = baths = sqft = None
    if details_el:
        text = details_el.inner_text()
        bed_match = re.search(r'(\d+)\s*(?:bd|bed)', text, re.IGNORECASE)
        bath_match = re.search(r'(\d+)\s*(?:ba|bath)', text, re.IGNORECASE)
        sqft_match = re.search(r'([\d,]+)\s*(?:sqft|sq)', text, re.IGNORECASE)
        beds = int(bed_match.group(1)) if bed_match else None
        baths = int(bath_match.group(1)) if bath_match else None
        sqft = int(sqft_match.group(1).replace(',', '')) if sqft_match else None

    # Link
    link_el = card.query_selector('a[href*="/homedetails/"]')
    url = f"https://www.zillow.com{link_el.get_attribute('href')}" if link_el else ''

    listing = {
        'zpid': None,
        'address_street': parts.get('street', ''),
        'address_city': parts.get('city', ''),
        'address_state': parts.get('state', ''),
        'address_zip': parts.get('zip', ''),
        'address_full': addr_text,
        'price': price,
        'beds': beds,
        'baths': baths,
        'sqft': sqft,
        'zestimate': None,
        'days_on_zillow': None,
        'listing_url': url,
        'source': 'zillow_fsbo',
        'market': market,
        'property_type': 'unknown',
        'description': '',
    }

    listing['distress_signals'] = _detect_distress_signals(listing)
    return listing


def ingest_fsbo_listings(store: Any, listings: list[dict], log_fn: Any = print) -> dict:
    """Ingest scraped FSBO listings into the Hermes store as leads."""
    created = 0
    skipped = 0
    updated = 0

    for listing in listings:
        street = listing.get('address_street', '')
        city = listing.get('address_city', '')
        state = listing.get('address_state', '')
        zipcode = listing.get('address_zip', '')

        if not street:
            skipped += 1
            continue

        try:
            with store._connect() as conn:
                conn.execute("PRAGMA foreign_keys = OFF")
                # Check if property already exists
                existing = conn.execute(
                    "SELECT property_id FROM properties WHERE lower(address_street) = ? AND lower(address_city) = ?",
                    (street.lower(), city.lower()),
                ).fetchone()

                if existing:
                    # Update existing — stack distress signals
                    prop_id = existing['property_id']
                    lead_row = conn.execute(
                        "SELECT lead_id, distress_signals_json FROM leads WHERE property_id = ?",
                        (prop_id,),
                    ).fetchone()
                    if lead_row:
                        existing_signals = json.loads(lead_row['distress_signals_json'] or '[]')
                        new_signals = listing.get('distress_signals', [])
                        merged = list(set(existing_signals + new_signals))
                        conn.execute(
                            "UPDATE leads SET distress_signals_json = ?, source = CASE WHEN source NOT LIKE '%zillow_fsbo%' THEN source || '+zillow_fsbo' ELSE source END WHERE lead_id = ?",
                            (json.dumps(merged), lead_row['lead_id']),
                        )
                        updated += 1
                        log_fn(f"[zillow-fsbo] Stacked signals on {street}: {merged}")
                    else:
                        skipped += 1
                    continue

                # Create new property + owner + lead
                from hashlib import sha256
                addr_key = f"{street}:{city}:{state}:{zipcode}".lower()
                prop_id = f"zillow:{sha256(addr_key.encode()).hexdigest()[:16]}"
                owner_id = f"zillow_owner:{sha256(addr_key.encode()).hexdigest()[:16]}"
                lead_id = f"zillow_fsbo:{sha256(addr_key.encode()).hexdigest()[:24]}"

                conn.execute(
                    """INSERT OR IGNORE INTO properties
                       (property_id, address_street, address_city, address_state, address_zip,
                        property_type, bedrooms, bathrooms, square_feet, year_built, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))""",
                    (prop_id, street, city, state, zipcode,
                     listing.get('property_type', 'unknown'),
                     listing.get('beds'), listing.get('baths'), listing.get('sqft')),
                )

                conn.execute(
                    """INSERT OR IGNORE INTO owners
                       (owner_id, property_id, owner_name, owner_type, updated_at)
                       VALUES (?, ?, 'FSBO Seller', 'individual', datetime('now'))""",
                    (owner_id, prop_id),
                )

                signals = listing.get('distress_signals', ['fsbo'])
                conn.execute(
                    """INSERT OR IGNORE INTO leads
                       (lead_id, property_id, owner_id, source, status,
                        distress_signals_json, motivation_score, motivation_tier,
                        arv_estimate, mao, persona_primary,
                        router_decision, router_reason, created_at, updated_at)
                       VALUES (?, ?, ?, 'zillow_fsbo', 'new',
                        ?, NULL, NULL,
                        ?, ?, 'FSBO Seller',
                        'proceed', ?, datetime('now'), datetime('now'))""",
                    (lead_id, prop_id, owner_id,
                     json.dumps(signals),
                     listing.get('zestimate'),
                     listing.get('price'),
                     f"FSBO listing in {city}, {state} — {len(signals)} distress signals: {', '.join(signals)}"),
                )
                created += 1
                log_fn(f"[zillow-fsbo] Created lead: {street}, {city} — signals: {signals}")

        except Exception as exc:
            log_fn(f"[zillow-fsbo] Error ingesting {street}: {exc}")
            skipped += 1

    result = {"created": created, "updated": updated, "skipped": skipped, "total": len(listings)}
    log_fn(f"[zillow-fsbo] Ingestion done: {created} created, {updated} updated, {skipped} skipped")
    return result
