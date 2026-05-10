import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "debug-save");

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
      for (var i = 0; i < cbs.length; i++) {
        var label = cbs[i].closest('label') || cbs[i].parentElement;
        if (label && /do not show/i.test(label.textContent || "")) {
          if (!cbs[i].checked) cbs[i].click();
        }
      }
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        if (/^close$/i.test(t)) {
          var r = btns[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { btns[i].click(); return "closed"; }
        }
      }
      return null;
    })()`);
    if (dismissed) await page.waitForTimeout(1000);
    else break;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const close = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2000);
    } else break;
  }
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
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

  const ZIP = "Cuyahoga County, OH";
  const listName = `debug-save-test-${Date.now()}`;

  // ===== PAGE 1: Create list =====
  console.log("\n=== PAGE 1: Create list ===");
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);

  // Enter location
  const zipInput = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
  await zipInput.click({ force: true });
  await page.waitForTimeout(300);
  await zipInput.fill(ZIP);
  await page.waitForTimeout(1000);
  const suggestion = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) await suggestion.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Filters
  const filtersBtn = page.getByText(/^filters$/i).first();
  if (await filtersBtn.isVisible().catch(() => false)) {
    await filtersBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  await page.evaluate(toggleFilterJS("Pre-Probate"));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  // Close filter panel
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent;
      }
      if (/^filters$/i.test(t.trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  // Select checkboxes
  const checked1 = await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
  console.log(`Checked: ${checked1}`);

  // Actions → Save
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(800);

  await page.evaluate(`(function(){
    var re = /^Save$/i;
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      if (re.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-save-modal-p1.png") });

  // Fill list name
  const listInput = page.locator('[placeholder*="Select or Type"]').first();
  await listInput.click();
  await page.waitForTimeout(300);
  await listInput.fill(listName);
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-name-typed-p1.png") });

  // Create as New List
  await page.evaluate(`(function(){
    var best = null; var bestArea = Infinity;
    var els = document.querySelectorAll("div, span, li, a, p, option");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      if (/create.*new.*list/i.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        var area = r.width * r.height;
        if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; }
      }
    }
    if (best) best.click();
  })()`);
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-create-new-p1.png") });

  // Click Save
  const saveResult1 = await page.evaluate(`(function(){
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      var r = btns[i].getBoundingClientRect();
      if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) {
        btns[i].click();
        return { clicked: true, text: t, x: Math.round(r.x), y: Math.round(r.y) };
      }
    }
    return { clicked: false };
  })()`);
  console.log(`Save p1: ${JSON.stringify(saveResult1)}`);
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "04-after-save-p1.png") });

  // ===== PAGE 2: Add to existing list =====
  console.log("\n=== PAGE 2: Add to existing list ===");
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);

  // Re-enter location
  const zipInput2 = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
  await zipInput2.click({ force: true });
  await page.waitForTimeout(300);
  await zipInput2.fill(ZIP);
  await page.waitForTimeout(1000);
  const sugg2 = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await sugg2.isVisible({ timeout: 3000 }).catch(() => false)) await sugg2.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Re-apply filters
  const filtersBtn2 = page.getByText(/^filters$/i).first();
  if (await filtersBtn2.isVisible().catch(() => false)) {
    await filtersBtn2.click({ force: true });
    await page.waitForTimeout(1500);
  }
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  await page.evaluate(toggleFilterJS("Pre-Probate"));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  // Close filter panel
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent;
      }
      if (/^filters$/i.test(t.trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  // Force-close filter overlay
  await page.evaluate(`(function(){
    var overlays = document.querySelectorAll('[class*="SearchFilterNew"][class*="overlay"], [class*="filterOverlay"]');
    for (var i = 0; i < overlays.length; i++) {
      overlays[i].style.display = "none";
      overlays[i].style.pointerEvents = "none";
    }
  })()`);
  await page.waitForTimeout(500);

  // Navigate to page 2
  const navResult = await page.evaluate(`(function(){
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    var inputs = document.querySelectorAll('[class*="Paginator"] input, [class*="paginator"] input');
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y > 700) {
        inputs[i].focus();
        ns.call(inputs[i], "2");
        inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
        inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
        inputs[i].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        inputs[i].dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        return { filled: true, val: inputs[i].value };
      }
    }
    return { filled: false };
  })()`);
  console.log(`Nav to page 2: ${JSON.stringify(navResult)}`);
  await page.waitForTimeout(3000);

  // Select checkboxes on page 2
  const checked2 = await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
  console.log(`Checked p2: ${checked2}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "05-page2-checked.png") });

  // Actions → Save
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(800);

  await page.evaluate(`(function(){
    var re = /^Save$/i;
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      if (re.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "06-save-modal-p2.png") });

  // Type list name
  const listInput2 = page.locator('[placeholder*="Select or Type"]').first();
  await listInput2.click();
  await page.waitForTimeout(300);
  await listInput2.fill(listName);
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "07-name-typed-p2.png") });

  // List all dropdown options
  const dropdownItems = await page.evaluate(`(function(){
    var items = [];
    var els = document.querySelectorAll("div, span, li, a, option");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var t = ownText.trim();
      if (t.length > 3 && t.length < 100) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 100 && r.height > 10 && r.height < 60 && r.y > 300 && r.y < 600 && r.x > 200 && r.x < 800) {
          items.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tag: els[i].tagName });
        }
      }
    }
    return items;
  })()`);
  console.log("Dropdown items:", JSON.stringify(dropdownItems, null, 2));

  // Try clicking the existing list
  const selectResult = await page.evaluate(`(function(){
    var name = ${JSON.stringify(listName)};
    var els = document.querySelectorAll("div, span, li, a, option");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var t = ownText.trim();
      if (t === name) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 60) {
          els[i].click();
          return { selected: "exact", text: t, x: Math.round(r.x), y: Math.round(r.y) };
        }
      }
    }
    return { selected: null };
  })()`);
  console.log(`Select: ${JSON.stringify(selectResult)}`);
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "08-after-select-p2.png") });

  // Check if Save button is available and what it says
  const saveState = await page.evaluate(`(function(){
    var btns = document.querySelectorAll('button');
    var results = [];
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      var r = btns[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && t.length > 0 && t.length < 30) {
        if (/save|add|submit|cancel/i.test(t)) {
          results.push({ text: t, disabled: btns[i].disabled, x: Math.round(r.x), y: Math.round(r.y) });
        }
      }
    }
    return results;
  })()`);
  console.log("Buttons:", JSON.stringify(saveState));

  // Click Save
  const saveResult2 = await page.evaluate(`(function(){
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      var r = btns[i].getBoundingClientRect();
      if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) {
        btns[i].click();
        return { clicked: true, text: t };
      }
    }
    return { clicked: false };
  })()`);
  console.log(`Save p2: ${JSON.stringify(saveResult2)}`);
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "09-after-save-p2.png") });

  // Navigate to My Properties and check the list count
  console.log("\n=== Checking list ===");
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  // Find the list and its count
  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await page.evaluate(`(function(){
      var name = ${JSON.stringify(listName)};
      var labels = document.querySelectorAll('[class*="labelName"]');
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t.startsWith(name.substring(0, 15))) {
          // Also find the count next to it
          var parent = labels[i].closest('[class*="labelItem"]') || labels[i].parentElement;
          var countText = parent ? (parent.textContent || "").replace(/\\s+/g, " ").trim() : "";
          return { name: t, context: countText.slice(0, 100) };
        }
      }
      return null;
    })()`);
    if (found) {
      console.log(`Found list: ${JSON.stringify(found)}`);
      break;
    }
    await page.evaluate(`(function(){
      var panels = document.querySelectorAll('[class*="LeftPanel"], [class*="leftPanel"]');
      for (var i = 0; i < panels.length; i++) {
        var r = panels[i].getBoundingClientRect();
        if (r.width > 50 && r.height > 100 && r.x < 400) panels[i].scrollTop += 300;
      }
    })()`);
    await page.waitForTimeout(1000);
  }

  await browser.close();
})();
