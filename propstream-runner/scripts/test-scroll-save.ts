import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "scroll-save-test");

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

async function scrollView(page: any, px: number) {
  await page.evaluate(`(function(){
    var divs = document.querySelectorAll("div");
    for (var i = 0; i < divs.length; i++) {
      var cls = (divs[i].className || "");
      if (/view/i.test(cls) && divs[i].scrollHeight > divs[i].clientHeight + 100) {
        var r = divs[i].getBoundingClientRect();
        if (r.x > 800 && r.width > 300 && r.height > 400) {
          divs[i].scrollTop += ${px};
          return;
        }
      }
    }
  })()`);
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

  // Step 1: Check first batch of checkboxes
  console.log("\n=== BATCH 1 (no scroll) ===");

  // Get addresses of first visible cards
  const batch1Addrs = await page.evaluate(`(function(){
    var addrs = [];
    var cards = document.querySelectorAll('[id^="property-"]');
    for (var i = 0; i < Math.min(5, cards.length); i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var spans = cards[i].querySelectorAll("span, p, div");
        for (var j = 0; j < spans.length; j++) {
          var t = (spans[j].textContent || "").trim();
          if (/\\d+.*\\w+.*(?:st|ave|rd|dr|blvd|ct|ln|way|cir|pl)/i.test(t) && t.length < 80) {
            addrs.push(t);
            break;
          }
        }
      }
    }
    return addrs;
  })()`);
  console.log(`First 5 addresses: ${JSON.stringify(batch1Addrs)}`);

  const checked1 = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) { if (!cbs[i].checked) { cbs[i].click(); if (cbs[i].checked) n++; } }
    return n;
  })()`);
  console.log(`Checked: ${checked1}`);

  // Step 2: Scroll down 2500px (about 50 cards)
  console.log("\n=== Scrolling down 2500px ===");
  await scrollView(page, 2500);
  await page.waitForTimeout(2000);

  // Check new addresses
  const batch2Addrs = await page.evaluate(`(function(){
    var addrs = [];
    var cards = document.querySelectorAll('[id^="property-"]');
    for (var i = 0; i < Math.min(5, cards.length); i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var spans = cards[i].querySelectorAll("span, p, div");
        for (var j = 0; j < spans.length; j++) {
          var t = (spans[j].textContent || "").trim();
          if (/\\d+.*\\w+.*(?:st|ave|rd|dr|blvd|ct|ln|way|cir|pl)/i.test(t) && t.length < 80) {
            addrs.push(t);
            break;
          }
        }
      }
    }
    return addrs;
  })()`);
  console.log(`Addresses after scroll: ${JSON.stringify(batch2Addrs)}`);
  const addressesChanged = batch2Addrs.length > 0 && batch1Addrs.length > 0 && batch2Addrs[0] !== batch1Addrs[0];
  console.log(`Addresses changed: ${addressesChanged}`);

  // Check how many boxes are still checked
  const stillChecked = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && cbs[i].checked) n++;
    }
    return n;
  })()`);
  console.log(`Still checked after scroll: ${stillChecked}`);

  // Check SELECTED badge
  const badge = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/\\d+.*selected/i.test(ownText.trim()) && ownText.length < 30) return ownText.trim();
    }
    return null;
  })()`);
  console.log(`Selected badge: ${badge}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-after-scroll.png") });

  // Step 3: Try checking boxes at this new scroll position
  const checked2 = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !cbs[i].checked) { cbs[i].click(); if (cbs[i].checked) n++; }
    }
    return n;
  })()`);
  console.log(`Checked at new position: ${checked2}`);

  // Check badge again
  const badge2 = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/\\d+.*selected/i.test(ownText.trim()) && ownText.length < 30) return ownText.trim();
    }
    return null;
  })()`);
  console.log(`Selected badge after check: ${badge2}`);

  // Step 4: Scroll back to top and check if original checkboxes are still checked
  console.log("\n=== Scrolling back to top ===");
  await page.evaluate(`(function(){
    var divs = document.querySelectorAll("div");
    for (var i = 0; i < divs.length; i++) {
      var cls = (divs[i].className || "");
      if (/view/i.test(cls) && divs[i].scrollHeight > divs[i].clientHeight + 100) {
        var r = divs[i].getBoundingClientRect();
        if (r.x > 800 && r.width > 300 && r.height > 400) { divs[i].scrollTop = 0; return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  const topAddrs = await page.evaluate(`(function(){
    var addrs = [];
    var cards = document.querySelectorAll('[id^="property-"]');
    for (var i = 0; i < Math.min(3, cards.length); i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var spans = cards[i].querySelectorAll("span, p, div");
        for (var j = 0; j < spans.length; j++) {
          var t = (spans[j].textContent || "").trim();
          if (/\\d+.*\\w+.*(?:st|ave|rd|dr|blvd|ct|ln|way|cir|pl)/i.test(t) && t.length < 80) {
            addrs.push(t);
            break;
          }
        }
      }
    }
    return addrs;
  })()`);
  console.log(`Top addresses after scroll back: ${JSON.stringify(topAddrs)}`);

  const topChecked = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && cbs[i].checked) n++;
    }
    return n;
  })()`);
  console.log(`Checked boxes back at top: ${topChecked}`);

  const badge3 = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/\\d+.*selected/i.test(ownText.trim()) && ownText.length < 30) return ownText.trim();
    }
    return null;
  })()`);
  console.log(`Selected badge at top: ${badge3}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-back-at-top.png") });

  await browser.close();
  console.log("\nDone.");
})();
