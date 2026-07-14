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
      for (var i = 0; i < cbs.length; i++) { var label = cbs[i].closest('label') || cbs[i].parentElement; if (label && /do not show/i.test(label.textContent || "")) { if (!cbs[i].checked) cbs[i].click(); } }
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); if (/^close$/i.test(t)) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { btns[i].click(); return "closed"; } } }
      return null;
    })()`);
    if (dismissed) await page.waitForTimeout(1000); else break;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const close = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) { await close.click({ force: true }).catch(() => undefined); await page.waitForTimeout(2000); } else break;
  }
}

async function dismissModals(page: any) {
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (/^(close|ok|done|got it|×|x)$/i.test((btns[i].textContent || "").trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50) { btns[i].click(); return; }
      }
    }
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

const ZIP = "Cuyahoga County, OH";
const SIGNAL = "probate";
const SIGNAL_TOGGLE = "Pre-Probate";
const BATCH_PREFIX = `probate-batch`;
const MAX_PAGES = 5;

async function searchAndApplyFilters(page: any) {
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);
  await page.evaluate(`(function(){ document.querySelectorAll('[class*="modalOverlay"]').forEach(function(el){ el.remove(); }); document.body.style.overflow = ""; })()`);

  const zipInput = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
  await zipInput.click({ force: true });
  await zipInput.fill(ZIP);
  await page.waitForTimeout(1000);
  const suggestion = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) await suggestion.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const filtersBtn = page.getByText(/^filters$/i).first();
  if (await filtersBtn.isVisible().catch(() => false)) { await filtersBtn.click({ force: true }); await page.waitForTimeout(1500); }
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  await page.evaluate(toggleFilterJS(SIGNAL_TOGGLE));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  // Close filter panel
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(1500);
  // Force-close overlay
  await page.evaluate(`(function(){ var overlays = document.querySelectorAll('[class*="SearchFilterNew"][class*="overlay"], [class*="filterOverlay"]'); for (var i = 0; i < overlays.length; i++) { overlays[i].style.display = "none"; overlays[i].style.pointerEvents = "none"; } })()`);
  await page.waitForTimeout(1000);
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome", viewport: { width: 1400, height: 900 }, acceptDownloads: true,
  });
  const page = browser.pages()[0] || await browser.newPage();

  await page.goto("https://login.propstream.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const allowAll = page.locator('button:has-text("Accept All"), #accept-recommended-btn-handler').first();
  if (await allowAll.count().catch(() => 0)) await allowAll.click({ force: true }).catch(() => undefined);
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    console.log("Logging in...");
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  const batchResults: { page: number; listName: string; saved: number; groupId: string | null; ordered: boolean }[] = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`PAGE ${pageNum}/${MAX_PAGES}`);
    console.log(`${"=".repeat(50)}`);

    const listName = `${BATCH_PREFIX}-p${pageNum}-${Date.now()}`;

    // Reload search and re-apply filters for each page
    await searchAndApplyFilters(page);
    await page.waitForTimeout(2000);

    // Navigate to target page if not page 1
    if (pageNum > 1) {
      const navResult = await page.evaluate(`(function(){
        var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        var inputs = document.querySelectorAll('[class*="Paginator"] input, [class*="paginator"] input');
        for (var i = 0; i < inputs.length; i++) {
          var r = inputs[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.y > 700) {
            inputs[i].focus();
            ns.call(inputs[i], "${pageNum}");
            inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
            inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
            inputs[i].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
            inputs[i].dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
            return { filled: true, val: inputs[i].value };
          }
        }
        return { filled: false };
      })()`);
      console.log(`  Nav to page ${pageNum}: ${JSON.stringify(navResult)}`);
      await page.waitForTimeout(3000);
    }

    // Select checkboxes
    const checked = await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
    console.log(`  Checked: ${checked}`);

    if (checked === 0) {
      console.log(`  No checkboxes — skipping`);
      continue;
    }

    // Actions → Save
    await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
    await page.waitForTimeout(800);
    await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/^save$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
    await page.waitForTimeout(2000);

    // Fill list name → Create as New List → Save
    const listInput = page.locator('[placeholder*="Select or Type"]').first();
    if (!(await listInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log(`  Save modal not visible — skipping`);
      continue;
    }
    await listInput.click();
    await page.waitForTimeout(300);
    await listInput.fill(listName);
    await page.waitForTimeout(800);

    // Create new list
    await page.evaluate(`(function(){ var best = null; var bestArea = Infinity; var els = document.querySelectorAll("div, span, li, a, p"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/create.*new.*list/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); var area = r.width * r.height; if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; } } } if (best) best.click(); })()`);
    await page.waitForTimeout(500);

    // Click Save
    await page.evaluate(`(function(){ var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { var t = (btns[i].textContent || "").trim(); var r = btns[i].getBoundingClientRect(); if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) { btns[i].click(); return; } } })()`);
    console.log(`  Saved to "${listName}"`);
    await page.waitForTimeout(5000);

    // Navigate to list and get group ID
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    await dismissEverything(page);
    await page.waitForTimeout(1000);

    let groupId: string | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      const found = await page.evaluate(`(function(){
        var name = ${JSON.stringify(listName)};
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === name) { labels[i].click(); return t; }
        }
        return null;
      })()`);
      if (found) {
        await page.waitForTimeout(2000);
        const m = page.url().match(/property\/group\/[^/]+\/(\d+)/);
        if (m) {
          groupId = m[1];
          await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(4000);
          await dismissEverything(page);
        }
        break;
      }
      await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
      await page.waitForTimeout(1000);
    }
    console.log(`  Group ID: ${groupId}`);

    // Skip Trace
    let ordered = false;
    if (groupId) {
      // Select header checkbox
      const hdrCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
      for (let hi = 0; hi < await hdrCells.count().catch(() => 0); hi++) {
        const box = await hdrCells.nth(hi).boundingBox().catch(() => null);
        if (box && box.width > 0 && box.x > 10) {
          await page.mouse.click(box.x + 12, box.y + box.height / 2);
          await page.waitForTimeout(500);
          break;
        }
      }

      // Click Skip Trace
      const skipBtns = page.locator("button").filter({ hasText: /^Skip Trace$/ });
      for (let si = 0; si < await skipBtns.count(); si++) {
        const box = await skipBtns.nth(si).boundingBox().catch(() => null);
        if (box && box.width > 0) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); break; }
      }
      await page.waitForTimeout(3000);

      // Handle "in progress" blocker
      const inProgress = await page.evaluate(`(function(){ var els = document.querySelectorAll("*"); for (var i = 0; i < els.length; i++) { if (/skip trace in progress/i.test(els[i].textContent || "")) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return true; } } return false; })()`);
      if (inProgress) {
        console.log(`  Skip trace in progress — waiting 2 min...`);
        await dismissModals(page);
        await page.waitForTimeout(120000);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        await dismissEverything(page);
        // Re-select + re-click
        for (let hi = 0; hi < await hdrCells.count().catch(() => 0); hi++) {
          const box = await hdrCells.nth(hi).boundingBox().catch(() => null);
          if (box && box.width > 0 && box.x > 10) { await page.mouse.click(box.x + 12, box.y + box.height / 2); await page.waitForTimeout(500); break; }
        }
        for (let si = 0; si < await skipBtns.count(); si++) {
          const box = await skipBtns.nth(si).boundingBox().catch(() => null);
          if (box && box.width > 0) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); break; }
        }
        await page.waitForTimeout(3000);
      }

      // Fill name via coordinates
      const stName = `st-${SIGNAL}-p${pageNum}-${Date.now()}`;
      const inputInfo = await page.evaluate(`(function(){
        var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
          var r = inputs[i].getBoundingClientRect();
          var ph = (inputs[i].placeholder || "").toLowerCase();
          if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 500 && (ph.includes("list") || ph.includes("name") || ph.includes("enter"))) {
            return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
          }
        }
        return null;
      })()`);
      if (inputInfo) {
        await page.mouse.click(inputInfo.x, inputInfo.y, { clickCount: 3 });
        await page.waitForTimeout(100);
        await page.keyboard.type(stName, { delay: 20 });
        await page.waitForTimeout(500);
      }

      // Re-Skip Trace toggle
      await page.evaluate(`(function(){ var els = document.querySelectorAll("label, span, div"); for (var i = 0; i < els.length; i++) { if (/re-skip trace/i.test(els[i].textContent || "")) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
      await page.waitForTimeout(300);

      // Place Order
      for (let wait = 0; wait < 8; wait++) {
        const os = await page.evaluate(`(function(){ var btns = document.querySelectorAll("button"); for (var i = 0; i < btns.length; i++) { if (/place order/i.test((btns[i].textContent||"").trim())) { var r = btns[i].getBoundingClientRect(); if (r.width>0&&r.height>0) return { v:true, d:btns[i].disabled, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) }; } } return { v:false }; })()`);
        if (os?.v && !os?.d) {
          await page.mouse.click(os.x, os.y);
          ordered = true;
          console.log(`  Place Order CLICKED`);
          await page.waitForTimeout(5000);
          await dismissModals(page);
          break;
        }
        await page.waitForTimeout(1000);
      }
      if (!ordered) { console.log(`  Place Order FAILED`); await dismissModals(page); }
    }

    batchResults.push({ page: pageNum, listName, saved: checked, groupId, ordered });
  }

  // Wait for all skip traces to process
  console.log(`\nWaiting 3 min for skip traces to process...`);
  await page.waitForTimeout(180000);

  // Export each list
  console.log(`\n${"=".repeat(50)}`);
  console.log("EXPORTING ALL BATCHES");
  console.log(`${"=".repeat(50)}`);

  const csvPaths: string[] = [];
  for (const batch of batchResults) {
    if (!batch.groupId) continue;

    console.log(`\nExporting page ${batch.page} (group ${batch.groupId})...`);
    await page.goto(`https://app.propstream.com/property/group/${batch.groupId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    // Select header
    const hdr = page.locator('.ag-header-cell[col-id="resultIndex"]');
    for (let hi = 0; hi < await hdr.count().catch(() => 0); hi++) {
      const box = await hdr.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) { await page.mouse.click(box.x + 12, box.y + box.height / 2); await page.waitForTimeout(800); break; }
    }

    // Actions → Export CSV
    const btns = page.locator("button");
    for (let ai = 0; ai < await btns.count(); ai++) {
      const text = await btns.nth(ai).textContent().catch(() => "");
      const box = await btns.nth(ai).boundingBox().catch(() => null);
      if (text?.trim() === "Actions" && box && box.width > 0 && box.y > 50 && box.y < 250) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        break;
      }
    }
    await page.waitForTimeout(1500);

    const dlPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
    const exportCsv = page.getByText("Export CSV", { exact: true }).last();
    if (await exportCsv.isVisible().catch(() => false)) await exportCsv.click();

    const dl = await dlPromise;
    if (dl) {
      const csvPath = path.join(OUTPUT_DIR, `probate-p${batch.page}.csv`);
      await dl.saveAs(csvPath);
      csvPaths.push(csvPath);

      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      const header = lines[0].split(",");
      const phoneIdx = header.findIndex((h: string) => h.trim() === "Phone 1");
      let withPhone = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols[phoneIdx]?.trim()) withPhone++;
      }
      console.log(`  Page ${batch.page}: ${lines.length - 1} rows, ${withPhone} with phone`);
    } else {
      console.log(`  Page ${batch.page}: no download`);
    }
  }

  // Merge all CSVs
  if (csvPaths.length > 0) {
    console.log("\nMerging CSVs...");
    const mergedPath = path.join(OUTPUT_DIR, "probate-final.csv");
    let headerLine = "";
    const allRows: string[] = [];

    for (const csvPath of csvPaths) {
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      if (!headerLine) headerLine = lines[0];
      allRows.push(...lines.slice(1));
    }

    fs.writeFileSync(mergedPath, headerLine + "\n" + allRows.join("\n") + "\n");
    const phoneIdx = headerLine.split(",").findIndex((h: string) => h.trim() === "Phone 1");
    let totalWithPhone = 0;
    for (const row of allRows) {
      const cols = row.split(",");
      if (cols[phoneIdx]?.trim()) totalWithPhone++;
    }
    console.log(`Merged: ${allRows.length} rows, ${totalWithPhone} with phone data`);
    console.log(`Output: ${mergedPath}`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("DONE");
  console.log(`${"=".repeat(50)}`);
  for (const b of batchResults) {
    console.log(`  Page ${b.page}: saved=${b.saved}, group=${b.groupId}, ordered=${b.ordered}`);
  }

  await browser.close();
})();
