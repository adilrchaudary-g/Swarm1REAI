import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-save-test");

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

  // Open Actions → Input Range
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Use Playwright mouse + keyboard to fill the inputs
  const leftCoords = await page.evaluate(`(function(){
    var inp = document.querySelector('[class*="inputBoxLeft"]');
    if (!inp) return null;
    var r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  const rightCoords = await page.evaluate(`(function(){
    var inp = document.querySelector('[class*="inputBoxRight"]');
    if (!inp) return null;
    var r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);

  if (!leftCoords || !rightCoords) {
    console.log("Range inputs not found!");
    await browser.close();
    return;
  }

  // Fill left = 1
  await page.mouse.click(leftCoords.x, leftCoords.y);
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(100);
  await page.keyboard.type("1", { delay: 30 });
  await page.waitForTimeout(300);

  // Fill right = 224
  await page.mouse.click(rightCoords.x, rightCoords.y);
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(100);
  await page.keyboard.type("224", { delay: 30 });
  await page.waitForTimeout(500);

  console.log("Range filled: 1 to 224");
  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-range-filled.png") });

  // Click Show Property Range
  const showBtn = await page.evaluate(`(function(){
    var els = document.querySelectorAll("button, span, div, a");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/show property range/i.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      }
    }
    return null;
  })()`);

  if (showBtn) {
    await page.mouse.click(showBtn.x, showBtn.y);
    console.log("Clicked Show Property Range");
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-after-show.png") });

  // Now check: are there any visual indicators of selection?
  const selectionInfo = await page.evaluate(`(function(){
    var results = {};
    // Check for "X SELECTED" text anywhere
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var ownText = "";
      for (var j = 0; j < all[i].childNodes.length; j++) { if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent; }
      if (/\\d+.*selected/i.test(ownText.trim()) && ownText.length < 30) {
        var r = all[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) results.selectedBadge = ownText.trim();
      }
    }
    // Check checkbox count
    var cbs = document.querySelectorAll("input[type='checkbox']");
    var totalCbs = 0, checkedCbs = 0;
    for (var i = 0; i < cbs.length; i++) {
      var r = cbs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { totalCbs++; if (cbs[i].checked) checkedCbs++; }
    }
    results.totalCbs = totalCbs;
    results.checkedCbs = checkedCbs;
    // Check property cards with a "selected" class or styling
    var cards = document.querySelectorAll("[id^='property-']");
    var selectedCards = 0;
    for (var i = 0; i < cards.length; i++) {
      var cls = (cards[i].className || "");
      if (/selected|active|highlight/i.test(cls)) selectedCards++;
    }
    results.selectedCards = selectedCards;
    return results;
  })()`);
  console.log(`Selection info: ${JSON.stringify(selectionInfo)}`);

  // NOW: Try opening Actions → Save directly (even if checkboxes don't show as checked)
  console.log("\nTrying Actions → Save after Show Property Range...");
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-actions-menu.png") });

  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/^save$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "04-save-modal.png") });

  // Check the save modal — does it say how many properties?
  const modalInfo = await page.evaluate(`(function(){
    var results = {};
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || "").trim();
      if (/\\d+.*propert|\\d+.*record|saving.*\\d+/i.test(t) && t.length < 60) {
        var r = all[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 100 && r.y < 500) {
          results.countText = t;
        }
      }
      // Look for the modal title or description
      if (/add to|marketing list|save/i.test(t) && t.length < 50 && t.length > 3) {
        var r = all[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 100 && r.y < 500) {
          if (!results.modalTexts) results.modalTexts = [];
          results.modalTexts.push(t);
        }
      }
    }
    // Check all inputs in the modal
    var inputs = document.querySelectorAll("input");
    results.inputs = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y > 100 && r.y < 500 && r.x > 300) {
        results.inputs.push({ ph: inputs[i].placeholder, val: inputs[i].value, type: inputs[i].type });
      }
    }
    return results;
  })()`);
  console.log(`Modal info: ${JSON.stringify(modalInfo, null, 2)}`);

  // If Save modal is open, try saving with a test name
  const listInput = page.locator('[placeholder*="Select or Type"]').first();
  if (await listInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const testName = `range-test-${Date.now()}`;
    await listInput.click();
    await page.waitForTimeout(300);
    await listInput.fill(testName);
    await page.waitForTimeout(800);

    // Click "Create as New List"
    await page.evaluate(`(function(){ var best = null; var bestArea = Infinity; var els = document.querySelectorAll("div, span, li, a, p"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/create.*new.*list/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); var area = r.width * r.height; if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; } } } if (best) best.click(); })()`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUTPUT_DIR, "05-name-filled.png") });

    // Click Save
    await page.evaluate(`(function(){ var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); var r = btns[i].getBoundingClientRect(); if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) { btns[i].click(); return; } } })()`);
    console.log(`Saved as "${testName}"`);
    await page.waitForTimeout(5000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, "06-after-save.png") });

    // Navigate to the list and check how many properties were saved
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    // Find the test list
    for (let scrollAttempt = 0; scrollAttempt < 15; scrollAttempt++) {
      const found = await page.evaluate(`(function(){
        var name = ${JSON.stringify(testName)};
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === name) {
            labels[i].click();
            return t;
          }
        }
        return null;
      })()`);
      if (found) {
        await page.waitForTimeout(3000);
        const url = page.url();
        console.log(`List URL: ${url}`);

        // Count properties in the list
        const listCount = await page.evaluate(`(function(){
          var els = document.querySelectorAll("span, div, p, h2");
          for (var i = 0; i < els.length; i++) {
            var ownText = "";
            for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
            var m = ownText.trim().match(/^Total\\s*(\\d+)/i);
            if (m) return parseInt(m[1]);
            m = ownText.trim().match(/^(\\d+)\\s*propert/i);
            if (m) return parseInt(m[1]);
          }
          // Count AG-Grid rows
          var rows = document.querySelectorAll('.ag-row');
          var visRows = 0;
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) visRows++;
          }
          return "visible:" + visRows;
        })()`);
        console.log(`Properties in list: ${listCount}`);

        await page.screenshot({ path: path.join(OUTPUT_DIR, "07-list-page.png") });
        break;
      }
      await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
      await page.waitForTimeout(1000);
    }
  } else {
    console.log("Save modal didn't open — the selection probably didn't work.");

    // Alternative: Just try saving WITHOUT Input Range — select 50 checkboxes normally
    console.log("\nFallback: Select visible checkboxes normally...");
    const checkedCount = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var n = 0;
      for (var i = 0; i < cbs.length; i++) {
        if (!cbs[i].checked) { cbs[i].click(); if (cbs[i].checked) n++; }
        else n++;
      }
      return n;
    })()`);
    console.log(`Checked: ${checkedCount}`);
  }

  await browser.close();
  console.log("\nDone.");
})();
