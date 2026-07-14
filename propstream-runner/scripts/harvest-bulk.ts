import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

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

async function dismissModals(page: any) {
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (/^(close|ok|done|got it|×|x)$/i.test((btns[i].textContent || "").trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50) { btns[i].click(); return true; }
      }
    }
    return false;
  })()`);
}

function toggleFilterJS(name: string) {
  return `(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(name)}){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`;
}

function expandSectionJS() {
  return `(function(){var els=document.querySelectorAll("h4,div,span,p");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(/value.*equity/i.test(t.trim())){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x<400&&r.x>50){els[i].click();return true}}}return false})()`;
}

function fillRangeJS(label: string, minVal: string | null, maxVal: string | null) {
  return `(function(){var h4s=document.querySelectorAll("h4,h3,h2");var tgt=null;for(var i=0;i<h4s.length;i++){var t="";for(var j=0;j<h4s[i].childNodes.length;j++){if(h4s[i].childNodes[j].nodeType===3)t+=h4s[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(label)}){var r=h4s[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.y>-100){tgt=h4s[i];break}}}if(!tgt)return false;var hr=tgt.getBoundingClientRect();var inps=document.querySelectorAll("input[placeholder='Min'],input[placeholder='Max']");var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;for(var i=0;i<inps.length;i++){var ir=inps[i].getBoundingClientRect();if(ir.width<=0||ir.height<=0)continue;var dy=ir.y-hr.y;var dx=Math.abs(ir.x-hr.x);if(dy>0&&dy<60&&dx<250){if(${minVal?`true`:`false`}&&inps[i].placeholder==="Min"){ns.call(inps[i],${JSON.stringify(minVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}if(${maxVal?`true`:`false`}&&inps[i].placeholder==="Max"){ns.call(inps[i],${JSON.stringify(maxVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}}}return true})()`;
}

async function getResultCount(page: any): Promise<number> {
  const text = await page.evaluate(`(function(){var els=document.querySelectorAll("*");for(var i=0;i<els.length;i++){var t=(els[i].textContent||"").trim();var m=t.match(/^(\\d[\\d,]*)\\s*PROPERT/i);if(m){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0)return m[1]}}return "0"})()`);
  return Number(String(text).replace(/,/g, "")) || 0;
}

async function closeFilterPanel(page: any) {
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
  await page.waitForTimeout(1500);
}

async function searchAndFilter(page: any, zip: string, signalToggle: string) {
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);

  // Force-dismiss any modal overlays
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"], [class*="ModalOverlay"], [class*="modal-backdrop"]').forEach(function(el){ el.remove(); });
    document.querySelectorAll('[class*="modalWrapper"], [class*="ModalWrapper"]').forEach(function(el){ el.remove(); });
    document.body.classList.remove("bodyModal");
    document.body.style.overflow = "";
  })()`);

  const zipInput = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
  await zipInput.click({ force: true });
  await page.waitForTimeout(300);
  await zipInput.fill(zip);
  await page.waitForTimeout(1000);
  const suggestion = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) await suggestion.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const filtersBtn = page.getByText(/^filters$/i).first();
  if (await filtersBtn.isVisible().catch(() => false)) {
    await filtersBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }

  console.log(`  Toggling Vacant...`);
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  console.log(`  Toggling ${signalToggle}...`);
  await page.evaluate(toggleFilterJS(signalToggle));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  await closeFilterPanel(page);
  await page.waitForTimeout(2000);
}

async function bulkSaveViaInputRange(page: any, count: number, listName: string): Promise<number> {
  const maxRange = Math.min(count, 3000);

  // Step 1: Find and use the "Input Range" feature
  // Look for the Input Range inputs in the search results toolbar
  console.log(`  Setting input range 1-${maxRange}...`);

  // The Input Range feature has two inputs for start/end range
  const setRange = await page.evaluate(`(function(){
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    // Find inputs near "Input Range" text
    var labels = document.querySelectorAll("span, div, label, p");
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").trim();
      if (/input range/i.test(t)) {
        var r = labels[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // Find nearby inputs
          var allInputs = document.querySelectorAll("input");
          var rangeInputs = [];
          for (var j = 0; j < allInputs.length; j++) {
            var ir = allInputs[j].getBoundingClientRect();
            if (ir.width > 0 && ir.height > 0) {
              var dy = Math.abs(ir.y - r.y);
              if (dy < 50 && ir.x > r.x) {
                rangeInputs.push({ input: allInputs[j], x: ir.x, y: ir.y });
              }
            }
          }
          rangeInputs.sort(function(a,b) { return a.x - b.x; });
          if (rangeInputs.length >= 2) {
            ns.call(rangeInputs[0].input, "1");
            rangeInputs[0].input.dispatchEvent(new Event("input", { bubbles: true }));
            rangeInputs[0].input.dispatchEvent(new Event("change", { bubbles: true }));
            ns.call(rangeInputs[1].input, "${maxRange}");
            rangeInputs[1].input.dispatchEvent(new Event("input", { bubbles: true }));
            rangeInputs[1].input.dispatchEvent(new Event("change", { bubbles: true }));
            return { found: true, count: rangeInputs.length, start: "1", end: "${maxRange}" };
          }
          return { found: true, count: rangeInputs.length, error: "not enough inputs" };
        }
      }
    }
    return { found: false };
  })()`);
  console.log(`  Input range: ${JSON.stringify(setRange)}`);

  if (!setRange?.found || setRange?.error) {
    // Fallback: try the master checkbox approach (select all visible)
    console.log(`  Input Range not found — falling back to checkbox selection`);
    const checked = await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
    console.log(`  Checked ${checked} checkboxes`);
    return checked;
  }

  // Step 2: Click "Show Property Range" button
  await page.waitForTimeout(500);
  const showRange = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      if (/show property range/i.test(t) || /show range/i.test(t) || /apply range/i.test(t)) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          btns[i].click();
          return { clicked: true, text: t };
        }
      }
    }
    // Also try a nearby button/icon
    var icons = document.querySelectorAll("[class*='inputRange'] button, [class*='InputRange'] button");
    for (var i = 0; i < icons.length; i++) {
      var r = icons[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        icons[i].click();
        return { clicked: true, text: "icon" };
      }
    }
    return { clicked: false };
  })()`);
  console.log(`  Show range: ${JSON.stringify(showRange)}`);
  await page.waitForTimeout(3000);

  // Step 3: After showing range, check how many are selected
  const selectedCount = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) {
      if (cbs[i].checked) n++;
    }
    return n;
  })()`);
  console.log(`  Selected after range: ${selectedCount}`);

  // If range didn't auto-select, select all visible checkboxes
  if (selectedCount === 0) {
    const checked = await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
    console.log(`  Manual check: ${checked}`);
    return checked;
  }

  return selectedCount;
}

async function runSignal(page: any, zip: string, signal: string, signalToggle: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`SIGNAL: ${signal}`);
  console.log(`${"=".repeat(60)}`);

  await searchAndFilter(page, zip, signalToggle);

  const count = await getResultCount(page);
  console.log(`  Found: ${count} properties`);

  if (count === 0) return null;

  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-01-results.png`) });

  const listName = `bulk-${signal}-${Date.now()}`;

  // Try bulk save via Input Range
  const selected = await bulkSaveViaInputRange(page, count, listName);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-02-selected.png`) });

  // Open Actions → Save
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

  // Screenshot actions dropdown
  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-03-actions.png`) });

  // Look for "Add to Marketing List" or "Save" in the dropdown
  const dropdownItems = await page.evaluate(`(function(){
    var items = [];
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, [class*='Dropdown'] div, li");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var t = ownText.trim();
      if (t.length > 1 && t.length < 60) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) items.push(t);
      }
    }
    return [...new Set(items)];
  })()`);
  console.log(`  Dropdown: ${dropdownItems.join(", ")}`);

  // Click "Save" or "Add to Marketing List"
  const saveClicked = await page.evaluate(`(function(){
    var targets = [/^Save$/i, /add to marketing list/i, /^Save to List$/i];
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li, [role='menuitem']");
    for (var t = 0; t < targets.length; t++) {
      for (var i = 0; i < els.length; i++) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) {
          if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
        }
        if (targets[t].test(ownText.trim())) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { els[i].click(); return ownText.trim(); }
        }
      }
    }
    return null;
  })()`);
  console.log(`  Clicked: ${saveClicked}`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-04-save-modal.png`) });

  // Fill list name
  const listInput = page.locator('[placeholder*="Select or Type"]').first();
  if (await listInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await listInput.click();
    await page.waitForTimeout(300);
    await listInput.fill(listName);
    await page.waitForTimeout(800);

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

    await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-05-name-filled.png`) });

    // Click Save
    await page.evaluate(`(function(){
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        var r = btns[i].getBoundingClientRect();
        if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) {
          btns[i].click(); return;
        }
      }
    })()`);
    console.log(`  Saved to "${listName}"`);
    await page.waitForTimeout(5000);
  } else {
    console.log(`  Save modal did not appear`);
    return null;
  }

  // Navigate to list
  console.log(`  Navigating to My Properties...`);
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  let groupId: string | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const labelClicked = await page.evaluate(`(function(){
      var listName = ${JSON.stringify(listName)};
      var labels = document.querySelectorAll('[class*="labelName"]');
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t === listName) { labels[i].click(); return t; }
      }
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t.startsWith(listName.substring(0, 15))) { labels[i].click(); return t; }
      }
      return null;
    })()`);
    if (labelClicked) {
      console.log(`  Clicked list: ${labelClicked}`);
      await page.waitForTimeout(2000);
      const url = page.url();
      const m = url.match(/property\/group\/[^/]+\/(\d+)/);
      if (m) {
        groupId = m[1];
        await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
      }
      break;
    }
    await page.evaluate(`(function(){
      var panels = document.querySelectorAll('[class*="LeftPanel"], [class*="leftPanel"]');
      for (var i = 0; i < panels.length; i++) {
        var r = panels[i].getBoundingClientRect();
        if (r.width > 50 && r.height > 100 && r.x < 400) panels[i].scrollTop += 300;
      }
    })()`);
    await page.waitForTimeout(1500);
  }
  await dismissEverything(page);

  // Read total from header
  const totalInList = await page.evaluate(`(function(){
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      var m = t.match(/^Total\\s*(\\d[\\d,]*)/);
      if (m) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 200) return parseInt(m[1].replace(/,/g, ""), 10);
      }
    }
    // Try to find the count in parentheses next to list name
    var labels = document.querySelectorAll('[class*="labelName"], [class*="labelCount"]');
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").trim();
      var m = t.match(/\\((\\d+)\\)/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  })()`);
  console.log(`  Total in list: ${totalInList}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-06-list-page.png`) });

  // Skip Trace
  console.log(`  Skip tracing...`);
  const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await headerCells.count().catch(() => 0); hi++) {
    const box = await headerCells.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(500);
      break;
    }
  }

  const skipBtns = page.locator("button").filter({ hasText: /^Skip Trace$/ });
  for (let si = 0; si < await skipBtns.count(); si++) {
    const box = await skipBtns.nth(si).boundingBox().catch(() => null);
    if (box && box.width > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.waitForTimeout(3000);

  // Handle "Skip Trace in Progress" blocker
  const inProgress = await page.evaluate(`(function(){
    var els = document.querySelectorAll("h2, h3, h4, p, div, span");
    for (var i = 0; i < els.length; i++) {
      if (/skip trace in progress/i.test(els[i].textContent || "")) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    }
    return false;
  })()`);
  if (inProgress) {
    console.log(`  Skip trace in progress — waiting 2 min...`);
    await dismissModals(page);
    await page.waitForTimeout(120000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissEverything(page);
    // Re-select and retry
    for (let hi = 0; hi < await headerCells.count().catch(() => 0); hi++) {
      const box = await headerCells.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(500);
        break;
      }
    }
    for (let si = 0; si < await skipBtns.count(); si++) {
      const box = await skipBtns.nth(si).boundingBox().catch(() => null);
      if (box && box.width > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        break;
      }
    }
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-07-skip-modal.png`) });

  // Fill skip trace name using coordinate-based input
  const stName = `st-${signal}-${Date.now()}`;
  const inputInfo = await page.evaluate(`(function(){
    var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      var ph = (inputs[i].placeholder || "").toLowerCase();
      if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 500) {
        if (ph.includes("list") || ph.includes("name") || ph.includes("enter")) {
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }
      }
    }
    return null;
  })()`);

  if (inputInfo) {
    const ix = inputInfo.x + inputInfo.w / 2;
    const iy = inputInfo.y + inputInfo.h / 2;
    await page.mouse.click(ix, iy);
    await page.waitForTimeout(200);
    await page.mouse.click(ix, iy, { clickCount: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.type(stName, { delay: 20 });
    console.log(`  Typed: ${stName}`);
  }
  await page.waitForTimeout(500);

  // Enable Re-Skip Trace
  await page.evaluate(`(function(){
    var els = document.querySelectorAll("label, span, div, p");
    for (var i = 0; i < els.length; i++) {
      if (/re-skip trace/i.test(els[i].textContent || "")) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(300);

  // Click Place Order
  let ordered = false;
  for (let wait = 0; wait < 8; wait++) {
    const orderState = await page.evaluate(`(function(){
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (/place order/i.test((btns[i].textContent || "").trim())) {
          var r = btns[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { visible: true, disabled: btns[i].disabled, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          }
        }
      }
      return { visible: false };
    })()`);

    if (orderState?.visible && !orderState?.disabled) {
      await page.mouse.click(orderState.x + orderState.w / 2, orderState.y + orderState.h / 2);
      ordered = true;
      console.log(`  Place Order CLICKED`);
      await page.waitForTimeout(5000);
      await dismissModals(page);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!ordered) {
    console.log(`  Place Order FAILED`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `bulk-${signal}-08-order-fail.png`) });
    await dismissModals(page);
  }

  // Wait for skip trace processing (scale wait time with property count)
  const waitTime = Math.max(90, Math.min(300, totalInList * 0.3));
  console.log(`  Waiting ${Math.round(waitTime)}s for skip trace processing...`);
  await page.waitForTimeout(waitTime * 1000);

  // Reload and export
  if (groupId) {
    await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissEverything(page);
  }

  // Select rows and export
  const headerCells2 = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await headerCells2.count().catch(() => 0); hi++) {
    const box = await headerCells2.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(800);
      break;
    }
  }

  const actionsBtns = page.locator("button");
  const actionsTotal = await actionsBtns.count();
  for (let ai = 0; ai < actionsTotal; ai++) {
    const text = await actionsBtns.nth(ai).textContent().catch(() => "");
    const box = await actionsBtns.nth(ai).boundingBox().catch(() => null);
    if (text?.trim() === "Actions" && box && box.width > 0 && box.y > 50 && box.y < 250) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.waitForTimeout(1500);

  const downloadPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  const exportCsv = page.getByText("Export CSV", { exact: true }).last();
  if (await exportCsv.isVisible().catch(() => false)) {
    await exportCsv.click();
    console.log(`  Export CSV clicked`);
  }

  const download = await downloadPromise;
  let csvPath: string | null = null;
  if (download) {
    csvPath = path.join(OUTPUT_DIR, `${signal}-final.csv`);
    await download.saveAs(csvPath);
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n").filter((l: string) => l.trim());
    const header = lines[0].split(",");
    const phone1Idx = header.findIndex((h: string) => h.trim() === "Phone 1");
    let withPhone = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols[phone1Idx]?.trim()) withPhone++;
    }
    console.log(`  CSV: ${lines.length - 1} rows, ${withPhone} with phone, ${Math.round(withPhone/(lines.length-1)*100)}% hit rate`);
  } else {
    console.log(`  WARNING: No CSV downloaded`);
  }

  return { signal, count, totalInList, ordered, csvPath };
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
  const allowAll = page.locator('button:has-text("Accept All"), #accept-recommended-btn-handler').first();
  if (await allowAll.count().catch(() => 0)) await allowAll.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(500);
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    console.log("Logging in...");
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  // Run just probate first to test the bulk save approach
  const ZIP = "Cuyahoga County, OH";
  const result = await runSignal(page, ZIP, "probate", "Pre-Probate");

  console.log(`\n${"=".repeat(60)}`);
  console.log("RESULT:", JSON.stringify(result, null, 2));
  console.log(`${"=".repeat(60)}`);

  await browser.close();
})();
