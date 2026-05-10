import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "api-save");

function toggleFilterJS(name: string) {
  return `(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(name)}){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`;
}
function expandSectionJS() {
  return `(function(){var els=document.querySelectorAll("h4,div,span,p");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(/value.*equity/i.test(t.trim())){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x<400&&r.x>50){els[i].click();return true}}}return false})()`;
}
function fillRangeJS(label: string, minVal: string | null, maxVal: string | null) {
  return `(function(){var h4s=document.querySelectorAll("h4,h3,h2");var tgt=null;for(var i=0;i<h4s.length;i++){var t="";for(var j=0;j<h4s[i].childNodes.length;j++){if(h4s[i].childNodes[j].nodeType===3)t+=h4s[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(label)}){var r=h4s[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.y>-100){tgt=h4s[i];break}}}if(!tgt)return false;var hr=tgt.getBoundingClientRect();var inps=document.querySelectorAll("input[placeholder='Min'],input[placeholder='Max']");var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;for(var i=0;i<inps.length;i++){var ir=inps[i].getBoundingClientRect();if(ir.width<=0||ir.height<=0)continue;var dy=ir.y-hr.y;var dx=Math.abs(ir.x-hr.x);if(dy>0&&dy<60&&dx<250){if(${minVal?`true`:`false`}&&inps[i].placeholder==="Min"){ns.call(inps[i],${JSON.stringify(minVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}if(${maxVal?`true`:`false`}&&inps[i].placeholder==="Max"){ns.call(inps[i],${JSON.stringify(maxVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}}}return true})()`;
}

async function dismissEverything(page: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const dismissed = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < cbs.length; i++) { var label = cbs[i].closest('label') || cbs[i].parentElement; if (label && /do not show/i.test(label.textContent || "")) { if (!cbs[i].checked) cbs[i].click(); } }
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); if (/^close$/i.test(t)) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { btns[i].click(); return "closed"; } } }
      return null;
    })()`);
    if (dismissed) await page.waitForTimeout(1000); else break;
  }
}

interface SearchConfig {
  signal: string;
  toggleName: string;
  listName: string;
}

const SIGNALS: SearchConfig[] = [
  { signal: "probate", toggleName: "Pre-Probate", listName: "probate-all" },
];

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome", viewport: { width: 1400, height: 900 },
  });
  const page = browser.pages()[0] || await browser.newPage();

  await page.goto("https://login.propstream.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  for (const cfg of SIGNALS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`SIGNAL: ${cfg.signal}`);
    console.log(`${"=".repeat(60)}`);

    // Search
    await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await dismissEverything(page);
    await page.evaluate(`(function(){ document.querySelectorAll('[class*="modalOverlay"]').forEach(function(el){ el.remove(); }); document.body.style.overflow = ""; })()`);

    const zipInput = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
    await zipInput.click({ force: true });
    await zipInput.fill("Cuyahoga County, OH");
    await page.waitForTimeout(1000);
    const suggestion = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
    if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) await suggestion.click();
    else await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    const filtersBtn = page.getByText(/^filters$/i).first();
    if (await filtersBtn.isVisible().catch(() => false)) { await filtersBtn.click({ force: true }); await page.waitForTimeout(1500); }
    await page.evaluate(toggleFilterJS("Vacant"));
    await page.waitForTimeout(300);
    await page.evaluate(toggleFilterJS(cfg.toggleName));
    await page.waitForTimeout(300);
    // Close filter panel
    await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
    await page.waitForTimeout(1500);
    await page.evaluate(`(function(){ var overlays = document.querySelectorAll('[class*="SearchFilterNew"][class*="overlay"], [class*="filterOverlay"]'); for (var i = 0; i < overlays.length; i++) { overlays[i].style.display = "none"; overlays[i].style.pointerEvents = "none"; } })()`);
    await page.waitForTimeout(3000);

    // Get total count
    const totalCount = await page.evaluate(`(function(){
      var els = document.querySelectorAll("span, div, p, h2, h3");
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || "").trim();
        var m = t.match(/^(\\d+)\\s*PROPERT/i);
        if (m) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.y < 200) return parseInt(m[1]);
        }
      }
      return 0;
    })()`);
    console.log(`Total results: ${totalCount}`);

    if (!totalCount) {
      console.log("No results — skipping");
      continue;
    }

    // Extract the search parameters from the listing API URL (intercepting first API call)
    let searchParams: any = null;
    const urlPromise = new Promise<string>((resolve) => {
      const handler = (req: any) => {
        const url = req.url();
        if (url.includes("/eqbackend/resource/auth/ps4/listing") && url.includes("countyId")) {
          page.removeListener("request", handler);
          resolve(url);
        }
      };
      page.on("request", handler);
    });

    // Trigger a listing request by checking a box
    await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      if (cbs.length > 0 && !cbs[0].checked) cbs[0].click();
    })()`);

    // Also try to get the listing URL from already-loaded requests by extracting from session state
    const listingUrl = await Promise.race([
      urlPromise,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 3000)),
    ]);

    // Parse URL params
    if (listingUrl) {
      const url = new URL(listingUrl);
      searchParams = {
        countyId: url.searchParams.get("countyId"),
        fips: url.searchParams.get("fips"),
        addressType: url.searchParams.get("addressType"),
        id: url.searchParams.get("id"),
      };
      console.log(`Search params: ${JSON.stringify(searchParams)}`);
    }

    // If we couldn't intercept, try extracting from the page's network state
    if (!searchParams) {
      searchParams = await page.evaluate(`(function(){
        // Try to find in performance entries
        var entries = performance.getEntriesByType("resource");
        for (var i = entries.length - 1; i >= 0; i--) {
          if (entries[i].name.includes("/listing") && entries[i].name.includes("countyId")) {
            try {
              var url = new URL(entries[i].name);
              return {
                countyId: url.searchParams.get("countyId"),
                fips: url.searchParams.get("fips"),
                addressType: url.searchParams.get("addressType"),
                id: url.searchParams.get("id")
              };
            } catch(e) {}
          }
        }
        return null;
      })()`);
      console.log(`Search params from perf: ${JSON.stringify(searchParams)}`);
    }

    if (!searchParams) {
      console.log("Couldn't extract search params — using defaults");
      searchParams = { countyId: "1944", fips: "39035", addressType: "N", id: "1944" };
    }

    // NOW: Make the Save API call directly with inputRange=true and startRange/endRange to get ALL
    const listName = `${cfg.listName}-${Date.now()}`;
    console.log(`\nSaving ALL ${totalCount} to "${listName}" via API...`);

    const saveResult = await page.evaluate(`(function(){
      return new Promise(function(resolve, reject) {
        var body = {
          endRange: ${totalCount},
          countyId: ${searchParams.countyId},
          fips: "${searchParams.fips}",
          addressType: "${searchParams.addressType}",
          resultOffset: 1,
          inputRange: true,
          type: null,
          id: ${searchParams.id},
          startRange: 1,
          estimatedValueGrowthPeriod: "ONE_MONTH",
          resultLimit: ${totalCount},
          listingType: "DEC",
          selection: [],
          selectionInversed: false
        };

        fetch("/eqbackend/resource/auth/ps4/user/listings?groupType=MARKETING&groupName=" + encodeURIComponent("${listName}"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body)
        })
        .then(function(r) { return r.text().then(function(t) { return { status: r.status, body: t }; }); })
        .then(resolve)
        .catch(function(e) { resolve({ error: e.message }); });
      });
    })()`);
    console.log(`Save API response: ${JSON.stringify(saveResult)}`);

    await page.waitForTimeout(3000);

    // Navigate to the list to verify
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    let groupId: string | null = null;
    for (let s = 0; s < 15; s++) {
      const found = await page.evaluate(`(function(){
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === ${JSON.stringify(listName)}) { labels[i].click(); return t; }
        }
        return null;
      })()`);
      if (found) {
        await page.waitForTimeout(3000);
        const url = page.url();
        const m = url.match(/property\/group\/(?:[^/]+\/)?(\d+)/);
        if (m) groupId = m[1];
        console.log(`Found list: ${url} → group ${groupId}`);
        break;
      }
      await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
      await page.waitForTimeout(1000);
    }

    if (groupId) {
      await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await dismissEverything(page);

      const listCount = await page.evaluate(`(function(){
        var els = document.querySelectorAll("*");
        for (var i = 0; i < els.length; i++) {
          var ownText = "";
          for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
          var m = ownText.trim().match(/^Total\\s*(\\d+)/i);
          if (m) return parseInt(m[1]);
        }
        return "unknown";
      })()`);
      console.log(`\n*** PROPERTIES IN LIST: ${listCount} (expected: ${totalCount}) ***`);

      await page.screenshot({ path: path.join(OUTPUT_DIR, `${cfg.signal}-list.png`) });
    }
  }

  await browser.close();
  console.log("\nDone.");
})();
