import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

async function dismissAlerts(page: any) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cb = page.locator('[class*="Alert-style"] input[type="checkbox"]').first();
    if (await cb.count().catch(() => 0)) {
      if (!(await cb.isChecked().catch(() => true))) await cb.check({ force: true }).catch(() => undefined);
    }
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

async function closeFilterPanel(page: any) {
  const closed = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent;
      }
      if (/^filters$/i.test(t.trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return "toggled"; }
      }
    }
    return false;
  })()`);
  console.log(`  Filter panel: ${closed}`);
  await page.waitForTimeout(1000);
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

async function selectAllCheckboxes(page: any): Promise<number> {
  return page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
}

async function openSearchActionsDropdown(page: any): Promise<any> {
  return page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn'], [class*='Actions']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) {
          btns[i].click();
          return { clicked: true, x: Math.round(r.x), y: Math.round(r.y) };
        }
      }
    }
    return { clicked: false };
  })()`);
}

async function clickDropdownItem(page: any, label: RegExp): Promise<boolean> {
  const patSrc = label.source;
  const patFlags = label.flags;
  return page.evaluate(`(function(){
    var re = new RegExp(${JSON.stringify(patSrc)}, ${JSON.stringify(patFlags)});
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, [class*='dropdown'] li, [class*='dropdown'] a, [class*='Dropdown'] div, [class*='menu'] li, [role='menuitem']");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      if (re.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return true; }
      }
    }
    return false;
  })()`);
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

  // Login
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

  const signal = "probate";
  const signalToggle = "Pre-Probate";
  const ZIP = "Cuyahoga County, OH";
  const listName = `harvest-probate-full-${Date.now()}`;

  // Force-dismiss any modal overlays
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"], [class*="ModalOverlay"], [class*="modal-backdrop"]').forEach(function(el){ el.remove(); });
    document.querySelectorAll('[class*="modalWrapper"], [class*="ModalWrapper"]').forEach(function(el){ el.remove(); });
    document.body.classList.remove("bodyModal");
    document.body.style.overflow = "";
  })()`);

  // Navigate to search
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissAlerts(page);
  await page.waitForTimeout(500);

  // Enter location
  let zipInput = null;
  for (const sel of [
    'div[class*="searchInput"] input',
    'input[placeholder*="County" i]',
    'input[placeholder*="Zip" i]',
    'input[placeholder*="Enter" i]',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      zipInput = loc;
      break;
    }
  }
  if (!zipInput) throw new Error("Could not find search input");

  await zipInput.click({ force: true });
  await page.waitForTimeout(300);
  await zipInput.fill(ZIP);
  await page.waitForTimeout(1000);

  const suggestion = page.locator('[class*="suggestion"], [class*="dropdown"] li, [class*="autocomplete"] div, [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
    await suggestion.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(2000);

  // Open filters
  const filtersBtn = page.getByText(/^filters$/i).first();
  if (await filtersBtn.isVisible().catch(() => false)) {
    await filtersBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }

  // Toggle: Vacant + Probate
  console.log("Toggling Vacant...");
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  console.log(`Toggling ${signalToggle}...`);
  await page.evaluate(toggleFilterJS(signalToggle));
  await page.waitForTimeout(300);

  // Equity + price
  console.log("Setting Equity ≥50%, Price ≤$500k...");
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  // Close filter panel
  await closeFilterPanel(page);
  await page.waitForTimeout(1500);

  await page.waitForTimeout(3000);
  const count = await getResultCount(page);
  console.log(`Found: ${count} properties`);

  if (count === 0) {
    console.log("No results — exiting");
    await browser.close();
    return;
  }

  const maxProperties = Math.min(count, 3000);
  let totalSaved = 0;
  const totalPages = Math.ceil(maxProperties / 50);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`\nPage ${pageNum}/${totalPages}: selecting checkboxes...`);

    const checked = await selectAllCheckboxes(page);
    console.log(`  Checked ${checked} checkboxes`);
    if (checked === 0) {
      console.log("  No checkboxes — trying one more page...");
      if (pageNum < totalPages) {
        // Skip to next page
      } else {
        break;
      }
    }

    if (checked > 0) {
      // Actions → Save
      await openSearchActionsDropdown(page);
      await page.waitForTimeout(800);
      await clickDropdownItem(page, /^Save$/i);
      await page.waitForTimeout(2000);

      const modalUp = await page.locator('[class*="AddToMarketingListModal"]').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (!modalUp) {
        console.log("  Modal did not appear — stopping");
        break;
      }

      // Fill list name
      const listInput = page.locator('[placeholder*="Select or Type"]').first();
      await listInput.click();
      await page.waitForTimeout(300);
      await listInput.fill(listName);
      await page.waitForTimeout(800);

      if (pageNum === 1) {
        // Create new list
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
        console.log(`  Created: ${listName}`);
      } else {
        // Select existing list
        await page.waitForTimeout(500);
        const selectedExisting = await page.evaluate(`(function(){
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
              if (r.width > 0 && r.height > 0 && r.height < 60) { els[i].click(); return "exact"; }
            }
          }
          // Partial match (name might include count suffix)
          for (var i = 0; i < els.length; i++) {
            var t = (els[i].textContent || "").trim();
            if (t.indexOf(name) === 0 && !/create/i.test(t)) {
              var r = els[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.height < 60) { els[i].click(); return "partial:" + t; }
            }
          }
          return null;
        })()`);
        console.log(`  Select existing: ${selectedExisting}`);
      }
      await page.waitForTimeout(500);

      // Screenshot save modal
      await page.screenshot({ path: path.join(OUTPUT_DIR, `probate-full-save-p${pageNum}.png`) });

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
      totalSaved += checked;
      console.log(`  Saved batch ${pageNum}. Total: ${totalSaved}`);
      await page.waitForTimeout(5000);
    }

    if (pageNum >= totalPages) break;

    // Reload search page for next batch
    await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await dismissAlerts(page);

    // Re-enter location
    let zipReInput = null;
    for (const sel of ['div[class*="searchInput"] input', 'input[placeholder*="County" i]', 'input[placeholder*="Enter" i]']) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) { zipReInput = loc; break; }
    }
    if (!zipReInput) { console.log(`  Could not find search input for page ${pageNum + 1}`); break; }

    await zipReInput.click({ force: true });
    await page.waitForTimeout(300);
    await zipReInput.fill(ZIP);
    await page.waitForTimeout(1000);
    const sugg = page.locator('[class*="suggestion"], [class*="dropdown"] li, [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
    if (await sugg.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sugg.click();
    } else {
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(2000);

    // Re-apply filters
    const filtersBtn2 = page.getByText(/^filters$/i).first();
    if (await filtersBtn2.isVisible().catch(() => false)) {
      await filtersBtn2.click({ force: true });
      await page.waitForTimeout(1500);
    }
    await page.evaluate(toggleFilterJS("Vacant"));
    await page.waitForTimeout(300);
    await page.evaluate(toggleFilterJS(signalToggle));
    await page.waitForTimeout(300);
    await page.evaluate(expandSectionJS());
    await page.waitForTimeout(800);
    await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
    await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
    await page.waitForTimeout(500);

    await closeFilterPanel(page);
    await page.waitForTimeout(1000);
    // Force-close overlay
    await page.evaluate(`(function(){
      var overlays = document.querySelectorAll('[class*="SearchFilterNew"][class*="overlay"], [class*="filterOverlay"]');
      for (var i = 0; i < overlays.length; i++) {
        overlays[i].style.display = "none";
        overlays[i].style.pointerEvents = "none";
      }
    })()`);
    await page.waitForTimeout(1000);

    // Navigate to target page
    const nextPage = pageNum + 1;
    const navResult = await page.evaluate(`(function(){
      var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      var inputs = document.querySelectorAll('[class*="Paginator"] input, [class*="paginator"] input');
      for (var i = 0; i < inputs.length; i++) {
        var r = inputs[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 700) {
          inputs[i].focus();
          ns.call(inputs[i], "${nextPage}");
          inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
          inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
          inputs[i].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          inputs[i].dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          return { filled: true, page: ${nextPage} };
        }
      }
      return { filled: false };
    })()`);
    console.log(`  Nav to page ${nextPage}: ${JSON.stringify(navResult)}`);
    await page.waitForTimeout(3000);
  }

  console.log(`\n=== Total saved: ${totalSaved} properties to "${listName}" ===`);

  if (totalSaved === 0) {
    await browser.close();
    return;
  }

  // Navigate to the list
  console.log("Navigating to My Properties...");
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissAlerts(page);
  await page.waitForTimeout(2000);

  let groupId: string | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const labelClicked = await page.evaluate(`(function(){
      var listName = ${JSON.stringify(listName)};
      var labels = document.querySelectorAll('[class*="labelName"]');
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t === listName) { labels[i].click(); return { found: "exact", text: t }; }
      }
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t.startsWith(listName.substring(0, 20))) { labels[i].click(); return { found: "prefix", text: t }; }
      }
      return null;
    })()`);
    if (labelClicked) {
      console.log(`List click: ${JSON.stringify(labelClicked)}`);
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

  await dismissAlerts(page);

  // Skip Trace
  console.log("Selecting rows for skip trace...");
  const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await headerCells.count().catch(() => 0); hi++) {
    const box = await headerCells.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(500);
      break;
    }
  }

  console.log("Clicking Skip Trace button...");
  const skipBtns = page.locator("button").filter({ hasText: /^Skip Trace$/ });
  for (let si = 0; si < await skipBtns.count(); si++) {
    const box = await skipBtns.nth(si).boundingBox().catch(() => null);
    if (box && box.width > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.waitForTimeout(3000);

  // Check for "Skip Trace in Progress" blocker
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
    console.log("Skip trace in progress — waiting 120s...");
    await dismissModals(page);
    await page.waitForTimeout(120000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
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

  await page.screenshot({ path: path.join(OUTPUT_DIR, "probate-full-skip-modal.png") });

  // Fill skip trace list name using coordinate-based input
  const stListName = `st-probate-full-${Date.now()}`;
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
    await page.keyboard.type(stListName, { delay: 20 });
    console.log(`Typed: ${stListName}`);
    await page.waitForTimeout(500);
  }

  // Enable Re-Skip Trace
  await page.evaluate(`(function(){
    var els = document.querySelectorAll("label, span, div, p");
    for (var i = 0; i < els.length; i++) {
      if (/re-skip trace/i.test(els[i].textContent || "")) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return true; }
      }
    }
    return false;
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
    console.log(`Place Order (attempt ${wait + 1}): ${JSON.stringify(orderState)}`);

    if (orderState?.visible && !orderState?.disabled) {
      await page.mouse.click(orderState.x + orderState.w / 2, orderState.y + orderState.h / 2);
      ordered = true;
      console.log("Place Order CLICKED");
      await page.waitForTimeout(5000);
      await dismissModals(page);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!ordered) {
    console.log("Place Order FAILED");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "probate-full-order-fail.png") });
    await dismissModals(page);
  }

  // Wait for skip trace processing
  console.log("Waiting 120s for skip trace processing...");
  await page.waitForTimeout(120000);

  // Reload and export
  if (groupId) {
    await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissAlerts(page);
  }

  // Select all rows
  const headerCells2 = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await headerCells2.count().catch(() => 0); hi++) {
    const box = await headerCells2.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(800);
      break;
    }
  }

  // Export CSV
  console.log("Opening Actions...");
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
    console.log("Export CSV clicked");
  }

  const download = await downloadPromise;
  if (download) {
    const csvPath = path.join(OUTPUT_DIR, "probate-final.csv");
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
    console.log(`CSV rows: ${lines.length - 1}`);
    console.log(`Rows with Phone 1: ${withPhone} / ${lines.length - 1}`);
    console.log(`Phone hit rate: ${Math.round((withPhone / (lines.length - 1)) * 100)}%`);
  } else {
    console.log("WARNING: No CSV downloaded");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "probate-full-export-fail.png") });
  }

  await browser.close();
})();
