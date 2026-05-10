import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "api-test");

function toggleFilterJS(name: string) {
  return `(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(name)}){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`;
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
  await page.evaluate(toggleFilterJS("Pre-Probate"));
  await page.waitForTimeout(300);
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);
  console.log("Filters applied.");

  // Step 1: Check 50 boxes and intercept the save API call
  const checked = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) { if (!cbs[i].checked) { cbs[i].click(); if (cbs[i].checked) n++; } }
    return n;
  })()`);
  console.log(`Checked: ${checked}`);

  // Intercept ALL API calls during Save
  const apiCalls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  page.on("request", (req: any) => {
    const url = req.url();
    if (url.includes("propstream.com") && (url.includes("eqbackend") || url.includes("api"))) {
      const headers = req.headers();
      apiCalls.push({
        url,
        method: req.method(),
        headers: {
          authorization: headers["authorization"] || "",
          "content-type": headers["content-type"] || "",
          cookie: (headers["cookie"] || "").substring(0, 100),
        },
        body: (req.postData() || "").substring(0, 2000),
      });
    }
  });

  // Open Actions → Save
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/^save$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  console.log(`\nAPI calls after opening Save modal: ${apiCalls.length}`);
  for (const c of apiCalls) console.log(`  ${c.method} ${c.url.substring(0, 120)}`);

  // Fill list name and save
  const listInput = page.locator('[placeholder*="Select or Type"]').first();
  if (await listInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const testName = `api-test-${Date.now()}`;
    await listInput.click();
    await page.waitForTimeout(300);
    await listInput.fill(testName);
    await page.waitForTimeout(800);

    await page.evaluate(`(function(){ var best = null; var bestArea = Infinity; var els = document.querySelectorAll("div, span, li, a, p"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/create.*new.*list/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); var area = r.width * r.height; if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; } } } if (best) best.click(); })()`);
    await page.waitForTimeout(500);

    apiCalls.length = 0; // Clear to capture only Save API calls

    // Click Save
    await page.evaluate(`(function(){ var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); var r = btns[i].getBoundingClientRect(); if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) { btns[i].click(); return; } } })()`);
    console.log(`\nClicked Save. Waiting for API calls...`);
    await page.waitForTimeout(5000);

    console.log(`\n${"=".repeat(60)}`);
    console.log("SAVE API CALLS CAPTURED:");
    console.log(`${"=".repeat(60)}`);
    for (const c of apiCalls) {
      console.log(`\n${c.method} ${c.url}`);
      console.log(`  Content-Type: ${c.headers["content-type"]}`);
      console.log(`  Auth: ${c.headers.authorization ? "present" : "none"}`);
      if (c.body) console.log(`  Body: ${c.body}`);
    }

    // Also extract cookies/auth token for manual API calls
    const cookies = await page.context().cookies();
    const authCookies = cookies.filter((c: any) => /auth|token|session/i.test(c.name));
    console.log(`\nAuth cookies: ${authCookies.map((c: any) => c.name).join(", ")}`);

    // Extract the listing/search ID from the URL
    const searchId = await page.evaluate(`(function(){
      // Check URL or localStorage/sessionStorage for search ID
      var url = window.location.href;
      var m = url.match(/id=(\\d+)/);
      if (m) return m[1];
      return null;
    })()`);
    console.log(`Search ID: ${searchId}`);
  }

  await browser.close();
  console.log("\nDone.");
})();
