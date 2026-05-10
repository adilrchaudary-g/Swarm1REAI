import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-v6");

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

  // --- Test 1: Open Input Range, DON'T touch inputs, click Show Property Range ---
  console.log("\n=== TEST 1: Default range (no input changes) ===");
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Read default values
  const defaults = await page.evaluate(`(function(){
    var l = document.querySelector('[class*="inputBoxLeft"]');
    var r = document.querySelector('[class*="inputBoxRight"]');
    return { lVal: l?.value, lPh: l?.placeholder, rVal: r?.value, rPh: r?.placeholder };
  })()`);
  console.log(`Default values: ${JSON.stringify(defaults)}`);

  // Click Show Property Range directly
  const showBtnEl = page.locator("button, span, div").filter({ hasText: /Show Property Range/i }).first();
  const showBox = await showBtnEl.boundingBox().catch(() => null);
  if (showBox) {
    await page.mouse.click(showBox.x + showBox.width / 2, showBox.y + showBox.height / 2);
    console.log("Clicked Show Property Range (defaults)");
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-default-after-show.png") });

  // Check for any selection indicators
  const info1 = await page.evaluate(`(function(){
    var result = {};
    // Property cards with highlighting
    var cards = document.querySelectorAll('[id^="property-"]');
    var highlighted = 0;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      var cls = (cards[i].className || "");
      var style = window.getComputedStyle(cards[i]);
      var bg = style.backgroundColor;
      // Check if there's any visual selection (border, bg change)
      if (/selected|active|checked|highlight/i.test(cls) || bg !== "rgb(255, 255, 255)") {
        highlighted++;
      }
    }
    result.highlightedCards = highlighted;
    // Check for checked checkboxes
    var cbs = document.querySelectorAll('input[type="checkbox"]');
    var vis = 0, chk = 0;
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { vis++; if (cbs[i].checked) chk++; }
    }
    result.visCbs = vis;
    result.chkCbs = chk;
    // Check "SELECTED" text
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var ownText = "";
      for (var j = 0; j < all[i].childNodes.length; j++) { if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent; }
      if (/\d+\s*selected/i.test(ownText.trim()) && ownText.length < 30) {
        result.selectedText = ownText.trim();
      }
    }
    return result;
  })()`);
  console.log(`Test 1 result: ${JSON.stringify(info1)}`);

  // Now try: Actions → Save while in Input Range mode (Save should be available)
  console.log("\nTrying Save from Actions while in Input Range mode...");
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);

  // Look at what's in the dropdown now
  const menuItems = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // Dropdown items typically appear below the Actions button (y > 150, y < 400)
      if (r.y < 150 || r.y > 350) continue;
      if (r.x < 1000) continue;
      var cls = (all[i].className || "");
      if (!/dropdown|menu/i.test(cls) && all[i].tagName !== "LI") continue;
      var ownText = "";
      for (var j = 0; j < all[i].childNodes.length; j++) { if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent; }
      if (ownText.trim() && ownText.length < 30) {
        results.push({ text: ownText.trim(), y: Math.round(r.y), tag: all[i].tagName, cls: cls.substring(0, 50) });
      }
    }
    return results;
  })()`);
  console.log(`Actions menu items: ${JSON.stringify(menuItems)}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-actions-dropdown.png") });

  // Click Save from dropdown
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/^save$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-after-save-click.png") });

  // Check if save modal appeared
  const saveModalVisible = await page.locator('[placeholder*="Select or Type"]').isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`Save modal visible: ${saveModalVisible}`);

  // Also check for "Add to Marketing List" text
  const modalText = await page.evaluate(`(function(){
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || "").trim();
      if (/add to marketing/i.test(t) && t.length < 60) {
        var r = all[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 100 && r.y < 400) return t;
      }
    }
    return null;
  })()`);
  console.log(`Modal text: ${modalText}`);

  if (saveModalVisible) {
    const testName = `range-test-all-${Date.now()}`;
    const input = page.locator('[placeholder*="Select or Type"]').first();
    await input.click();
    await page.waitForTimeout(300);
    await input.fill(testName);
    await page.waitForTimeout(800);

    await page.evaluate(`(function(){ var best = null; var bestArea = Infinity; var els = document.querySelectorAll("div, span, li, a, p"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/create.*new.*list/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); var area = r.width * r.height; if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; } } } if (best) best.click(); })()`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUTPUT_DIR, "04-save-modal-filled.png") });

    // Click Save button
    await page.evaluate(`(function(){ var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); var r = btns[i].getBoundingClientRect(); if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) { btns[i].click(); return; } } })()`);
    console.log(`Saved as "${testName}"`);
    await page.waitForTimeout(5000);

    // Check the list
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    for (let s = 0; s < 15; s++) {
      const found = await page.evaluate(`(function(){
        var name = ${JSON.stringify(testName)};
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === name) { labels[i].click(); return t; }
        }
        return null;
      })()`);
      if (found) {
        await page.waitForTimeout(3000);
        const url = page.url();
        const m = url.match(/property\/group\/(\d+)/);
        console.log(`Found list: ${url}`);

        if (m) {
          await page.goto(`https://app.propstream.com/property/group/${m[1]}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(5000);
          await dismissEverything(page);
        }

        const count = await page.evaluate(`(function(){
          var els = document.querySelectorAll("*");
          for (var i = 0; i < els.length; i++) {
            var ownText = "";
            for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
            var m = ownText.trim().match(/^Total\\s*(\\d+)/i);
            if (m) return parseInt(m[1]);
          }
          var rows = document.querySelectorAll('.ag-row');
          var n = 0;
          for (var i = 0; i < rows.length; i++) { var r = rows[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) n++; }
          return "visible:" + n;
        })()`);
        console.log(`*** PROPERTIES IN LIST: ${count} ***`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, "05-list-count.png") });
        break;
      }
      await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
      await page.waitForTimeout(1000);
    }
  } else {
    console.log("Save modal didn't appear — trying alternate approach");

    // Maybe we need to: Cancel input range, then check boxes, then save
    // OR: The "Save" in the actions dropdown IS the save action in Input Range mode
    // Maybe it saved silently? Check for a new list

    // Check all visible text for "saved" or success messages
    const msgs = await page.evaluate(`(function(){
      var results = [];
      var all = document.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].textContent || "").trim();
        if (/saved|success|added|created/i.test(t) && t.length < 60) {
          var r = all[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) results.push(t);
        }
      }
      return results.slice(0, 10);
    })()`);
    console.log(`Messages: ${JSON.stringify(msgs)}`);
  }

  await browser.close();
  console.log("\nDone.");
})();
