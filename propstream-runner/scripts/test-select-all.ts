import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "select-all-test");

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

  // Check total results
  const totalResults = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p, h2, h3");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/\\d+\\s*properties/i.test(t) && t.length < 30) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return t;
      }
    }
    return "unknown";
  })()`);
  console.log(`Total results: ${totalResults}`);

  // Step 1: Open Actions dropdown and examine ALL options
  console.log("\n--- Actions dropdown options ---");
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(1000);

  const menuItems = await page.evaluate(`(function(){
    var results = [];
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, [class*='dropdown'] li, [role='menuitem']");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      ownText = ownText.trim();
      if (!ownText) continue;
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        results.push({ text: ownText, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return results;
  })()`);
  for (const item of menuItems) {
    console.log(`  "${item.text}" at (${item.x}, ${item.y})`);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-actions-menu.png") });

  // Step 2: Click Input Range
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);
  console.log("\nInput Range opened.");

  // Step 3: Find and examine the range inputs
  const rangeInputs = await page.evaluate(`(function(){
    var results = [];
    var inputs = document.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      var cls = (inputs[i].className || "").toLowerCase();
      var ph = inputs[i].placeholder;
      if (/inputbox/i.test(cls) || /range/i.test(cls)) {
        results.push({
          x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
          w: Math.round(r.width), h: Math.round(r.height),
          cls: inputs[i].className.substring(0, 80), ph: ph, val: inputs[i].value, type: inputs[i].type
        });
      }
    }
    return results;
  })()`);
  console.log("Range inputs:");
  for (const inp of rangeInputs) {
    console.log(`  (${inp.x}, ${inp.y}) ${inp.w}x${inp.h} val="${inp.val}" ph="${inp.ph}" cls="${inp.cls}"`);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-input-range.png") });

  // Step 4: Use Playwright mouse click + keyboard.type (NOT React value setter)
  if (rangeInputs.length >= 2) {
    const leftInput = rangeInputs[0];
    const rightInput = rangeInputs[1];

    // Click left input, clear, type "1"
    await page.mouse.click(leftInput.x, leftInput.y, { clickCount: 3 });
    await page.waitForTimeout(200);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(100);
    await page.keyboard.type("1", { delay: 50 });
    await page.waitForTimeout(300);

    // Click right input, clear, type "228"
    await page.mouse.click(rightInput.x, rightInput.y, { clickCount: 3 });
    await page.waitForTimeout(200);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(100);
    await page.keyboard.type("228", { delay: 50 });
    await page.waitForTimeout(300);

    // Read back values
    const readBack = await page.evaluate(`(function(){
      var inputs = document.querySelectorAll("input");
      var results = [];
      for (var i = 0; i < inputs.length; i++) {
        var cls = (inputs[i].className || "").toLowerCase();
        if (/inputbox/i.test(cls)) {
          results.push({ val: inputs[i].value, cls: inputs[i].className.substring(0, 40) });
        }
      }
      return results;
    })()`);
    console.log(`\nRange values after type: ${JSON.stringify(readBack)}`);

    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-range-filled.png") });

    // Step 5: Click "Show Property Range"
    const showBtn = await page.evaluate(`(function(){
      var els = document.querySelectorAll("button, span, div, a");
      for (var i = 0; i < els.length; i++) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
        if (/show property range/i.test(ownText.trim())) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: ownText.trim() };
          }
        }
      }
      return null;
    })()`);
    console.log(`Show Property Range button: ${JSON.stringify(showBtn)}`);

    if (showBtn) {
      await page.mouse.click(showBtn.x, showBtn.y);
      console.log("Clicked Show Property Range");
      await page.waitForTimeout(5000);

      // Check how many checkboxes are now selected
      const selected = await page.evaluate(`(function(){
        var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
        var total = 0, checked = 0;
        for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
        return { total: total, checked: checked };
      })()`);
      console.log(`Checkboxes: ${selected.checked}/${selected.total} checked`);

      // Check for "SELECTED" badge
      const badges = await page.evaluate(`(function(){
        var results = [];
        var els = document.querySelectorAll("span, div, p");
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || "").trim();
          if (/selected/i.test(t) && t.length < 30) {
            var r = els[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.y < 200) results.push(t);
          }
        }
        return results;
      })()`);
      console.log(`Badges: ${JSON.stringify(badges)}`);

      await page.screenshot({ path: path.join(OUTPUT_DIR, "04-after-show.png") });
    }
  }

  // Step 6: Alternative — check if there's a "Select All" header checkbox
  console.log("\n--- Select All header checkbox ---");
  const headerCbs = await page.evaluate(`(function(){
    var results = [];
    var cbs = document.querySelectorAll("input[type='checkbox']");
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y < 130 && r.y > 40) {
        var label = cbs[i].closest("label") || cbs[i].parentElement;
        results.push({
          x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
          checked: cbs[i].checked, id: cbs[i].id,
          labelText: (label?.textContent || "").trim().substring(0, 40),
          cls: (cbs[i].className || "").substring(0, 50)
        });
      }
    }
    return results;
  })()`);
  console.log(`Header checkboxes: ${JSON.stringify(headerCbs, null, 2)}`);

  // Step 7: Check scroll behavior of property cards panel
  console.log("\n--- Scroll test ---");
  const scrollInfo = await page.evaluate(`(function(){
    // Find the scrollable container that holds property cards
    var containers = document.querySelectorAll('[class*="SearchResultCard"], [class*="resultPanel"], [class*="propertyCards"], [class*="propertyGrid"]');
    var parentInfo = [];
    for (var i = 0; i < containers.length; i++) {
      var p = containers[i].parentElement;
      while (p && p !== document.body) {
        if (p.scrollHeight > p.clientHeight + 50) {
          parentInfo.push({
            tag: p.tagName, cls: (p.className || "").substring(0, 80),
            scrollH: p.scrollHeight, clientH: p.clientHeight, scrollTop: p.scrollTop
          });
          break;
        }
        p = p.parentElement;
      }
    }
    // Also check specifically the right panel
    var divs = document.querySelectorAll("div");
    for (var i = 0; i < divs.length; i++) {
      var r = divs[i].getBoundingClientRect();
      if (r.x > 800 && r.width > 300 && r.height > 400) {
        if (divs[i].scrollHeight > divs[i].clientHeight + 50) {
          parentInfo.push({
            tag: "RIGHT-PANEL", cls: (divs[i].className || "").substring(0, 80),
            scrollH: divs[i].scrollHeight, clientH: divs[i].clientHeight, scrollTop: divs[i].scrollTop
          });
        }
      }
    }
    return parentInfo;
  })()`);
  console.log(JSON.stringify(scrollInfo, null, 2));

  await browser.close();
  console.log("\nDone.");
})();
