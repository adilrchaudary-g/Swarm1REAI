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

interface ListInfo {
  name: string;
  signal: string;
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

  // Navigate to My Properties
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissAlerts(page);
  await page.waitForTimeout(2000);

  // Screenshot to see current state of sidebar lists
  await page.screenshot({ path: path.join(OUTPUT_DIR, "re-skip-01-sidebar.png") });

  // Gather all marketing list names from the sidebar
  const allLists: string[] = await page.evaluate(`(function(){
    var labels = document.querySelectorAll('[class*="labelName"]');
    var names = [];
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
      if (t) names.push(t);
    }
    return names;
  })()`);
  console.log("Lists found:", allLists);

  // Find the harvest lists for each signal
  const signals = ["pre_foreclosure", "tax_delinquent", "probate"];
  const listsToProcess: ListInfo[] = [];

  for (const signal of signals) {
    const prefix = `harvest-${signal}-`;
    const match = allLists.find(n => n.startsWith(prefix));
    if (match) {
      listsToProcess.push({ name: match, signal });
      console.log(`  ${signal}: ${match}`);
    } else {
      // Try distressed-cuyahoga pattern
      const altPrefix = `distressed-cuyahoga-`;
      const altMatch = allLists.find(n => n.includes(signal.replace("_", "-").replace("_", "-")));
      if (altMatch) {
        listsToProcess.push({ name: altMatch, signal });
        console.log(`  ${signal}: ${altMatch} (alt pattern)`);
      } else {
        console.log(`  ${signal}: NOT FOUND`);
      }
    }
  }

  // Need to scroll sidebar to find more lists
  for (let scroll = 0; scroll < 5; scroll++) {
    await page.evaluate(`(function(){
      var panels = document.querySelectorAll('[class*="LeftPanel"], [class*="leftPanel"]');
      for (var i = 0; i < panels.length; i++) {
        var r = panels[i].getBoundingClientRect();
        if (r.width > 50 && r.height > 100 && r.x < 400) panels[i].scrollTop += 400;
      }
    })()`);
    await page.waitForTimeout(1000);
    const moreLists: string[] = await page.evaluate(`(function(){
      var labels = document.querySelectorAll('[class*="labelName"]');
      var names = [];
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t) names.push(t);
      }
      return names;
    })()`);

    for (const signal of signals) {
      if (listsToProcess.find(l => l.signal === signal)) continue;
      const prefix = `harvest-${signal}-`;
      const match = moreLists.find(n => n.startsWith(prefix));
      if (match) {
        listsToProcess.push({ name: match, signal });
        console.log(`  ${signal}: ${match} (found after scroll)`);
      }
    }
  }

  console.log(`\nProcessing ${listsToProcess.length} lists for skip trace + export`);

  const results: any[] = [];

  for (const listInfo of listsToProcess) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`RE-SKIP-TRACE: ${listInfo.signal} → "${listInfo.name}"`);
    console.log(`${"=".repeat(60)}`);

    // Navigate fresh to My Properties
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    await dismissAlerts(page);
    await page.waitForTimeout(1000);

    // Scroll to find and click the list
    let groupId: string | null = null;
    let found = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      const labelClicked = await page.evaluate(`(function(){
        var listName = ${JSON.stringify(listInfo.name)};
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === listName) {
            labels[i].click();
            return { found: "exact", text: t };
          }
        }
        // Prefix match (list names may be truncated)
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t.startsWith(listName.substring(0, 20))) {
            labels[i].click();
            return { found: "prefix", text: t };
          }
        }
        return null;
      })()`);

      if (labelClicked) {
        console.log(`  List click: ${JSON.stringify(labelClicked)}`);
        await page.waitForTimeout(3000);
        const url = page.url();
        const m = url.match(/property\/group\/[^/]+\/(\d+)/);
        if (m) {
          groupId = m[1];
          console.log(`  Group ID: ${groupId}`);
          await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(4000);
        }
        found = true;
        break;
      }

      // Scroll sidebar
      await page.evaluate(`(function(){
        var panels = document.querySelectorAll('[class*="LeftPanel"], [class*="leftPanel"]');
        for (var i = 0; i < panels.length; i++) {
          var r = panels[i].getBoundingClientRect();
          if (r.width > 50 && r.height > 100 && r.x < 400) panels[i].scrollTop += 300;
        }
      })()`);
      await page.waitForTimeout(1500);
    }

    if (!found) {
      console.log(`  SKIP: Could not find list "${listInfo.name}"`);
      results.push({ signal: listInfo.signal, error: "list not found" });
      continue;
    }

    await dismissAlerts(page);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-01-list.png`) });

    // Check the "Skip Traces" column to see if any have been done
    const skipTraceCount = await page.evaluate(`(function(){
      var cells = document.querySelectorAll('.ag-cell[col-id="skipTrace"], .ag-cell');
      var total = 0;
      for (var i = 0; i < cells.length; i++) {
        var colId = cells[i].getAttribute("col-id");
        if (colId && /skip/i.test(colId)) {
          var val = parseInt(cells[i].textContent || "0", 10);
          if (!isNaN(val) && val > 0) total++;
        }
      }
      return total;
    })()`);
    console.log(`  Rows with existing skip traces: ${skipTraceCount}`);

    // Read the "Total" count from the header
    const totalInList = await page.evaluate(`(function(){
      var els = document.querySelectorAll('[class*="StatsTitle"], [class*="statsValue"], th, td, span, div');
      for (var i = 0; i < els.length; i++) {
        var prev = els[i].previousElementSibling;
        if (prev && /total/i.test(prev.textContent || "")) {
          var n = parseInt((els[i].textContent || "").replace(/,/g, ""), 10);
          if (!isNaN(n) && n > 0) return n;
        }
      }
      // Try finding it from the stats bar
      var stats = document.querySelectorAll('[class*="Stats"] span, [class*="stats"] span');
      for (var i = 0; i < stats.length; i++) {
        if (/total/i.test(stats[i].textContent || "")) {
          var next = stats[i].nextElementSibling;
          if (next) {
            var n = parseInt((next.textContent || "").replace(/,/g, ""), 10);
            if (!isNaN(n) && n > 0) return n;
          }
        }
      }
      return 0;
    })()`);
    console.log(`  Total in list: ${totalInList}`);

    // Select all rows via header checkbox (Playwright mouse.click for AG-Grid)
    console.log(`  Selecting all rows...`);
    const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
    const hdrCount = await headerCells.count().catch(() => 0);
    let headerClicked = false;
    for (let hi = 0; hi < hdrCount; hi++) {
      const box = await headerCells.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(800);
        headerClicked = true;
        console.log(`  Clicked header checkbox at (${Math.round(box.x + 12)}, ${Math.round(box.y + box.height / 2)})`);
        break;
      }
    }
    if (!headerClicked) {
      console.log(`  WARNING: Could not find header checkbox`);
    }

    await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-02-selected.png`) });

    // Click Skip Trace toolbar button
    console.log(`  Clicking Skip Trace button...`);
    const skipBtns = page.locator("button").filter({ hasText: /^Skip Trace$/ });
    const skipBtnCount = await skipBtns.count();
    let skipBtnClicked = false;
    for (let si = 0; si < skipBtnCount; si++) {
      const box = await skipBtns.nth(si).boundingBox().catch(() => null);
      if (box && box.width > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        skipBtnClicked = true;
        console.log(`  Clicked Skip Trace at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
        break;
      }
    }
    if (!skipBtnClicked) {
      console.log(`  WARNING: Could not find Skip Trace button`);
    }
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-03-modal.png`) });

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
      console.log(`  Skip trace already in progress — waiting and retrying...`);
      await dismissModals(page);
      await page.waitForTimeout(60000); // Wait 1 minute
      // Retry
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      // Re-select and re-click
      for (let hi = 0; hi < hdrCount; hi++) {
        const box = await headerCells.nth(hi).boundingBox().catch(() => null);
        if (box && box.width > 0 && box.x > 10) {
          await page.mouse.click(box.x + 12, box.y + box.height / 2);
          await page.waitForTimeout(800);
          break;
        }
      }
      for (let si = 0; si < skipBtnCount; si++) {
        const box = await skipBtns.nth(si).boundingBox().catch(() => null);
        if (box && box.width > 0) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          break;
        }
      }
      await page.waitForTimeout(3000);
    }

    // Fill the list name in the Skip Trace modal — use multiple strategies
    console.log(`  Filling skip trace list name...`);
    const stListName = `st-${listInfo.signal}-${Date.now()}`;

    // Strategy 1: Find any visible input inside a modal-like container
    let nameFilled = false;
    const fillResult = await page.evaluate(`(function(){
      // Look for inputs that are visible and inside a modal
      var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (var i = 0; i < inputs.length; i++) {
        var r = inputs[i].getBoundingClientRect();
        // Must be visible, in the center area (modal), and have placeholder about list/name
        var ph = (inputs[i].placeholder || "").toLowerCase();
        if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 500) {
          if (ph.includes("list") || ph.includes("name") || ph.includes("enter")) {
            return {
              found: true,
              placeholder: inputs[i].placeholder,
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height)
            };
          }
        }
      }
      // Fallback: any input in the modal area that isn't a search/filter
      for (var i = 0; i < inputs.length; i++) {
        var r = inputs[i].getBoundingClientRect();
        if (r.width > 100 && r.height > 20 && r.y > 150 && r.y < 400 && r.x > 200 && r.x < 800) {
          return {
            found: true,
            placeholder: inputs[i].placeholder,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            fallback: true
          };
        }
      }
      return { found: false };
    })()`);
    console.log(`  Input search: ${JSON.stringify(fillResult)}`);

    if (fillResult?.found) {
      // Click the input at its coordinates
      const ix = fillResult.x + fillResult.w / 2;
      const iy = fillResult.y + fillResult.h / 2;
      await page.mouse.click(ix, iy);
      await page.waitForTimeout(300);
      // Triple-click to select all, then type
      await page.mouse.click(ix, iy, { clickCount: 3 });
      await page.waitForTimeout(200);
      await page.keyboard.type(stListName, { delay: 30 });
      await page.waitForTimeout(500);
      nameFilled = true;
      console.log(`  Typed list name: ${stListName}`);
    }

    // Also try Playwright locator as backup
    if (!nameFilled) {
      for (const sel of [
        'input[placeholder="Enter list name"]',
        'input[placeholder*="list name" i]',
        'input[placeholder*="Enter list" i]',
        'input[placeholder*="Name" i]',
      ]) {
        const inp = page.locator(sel).first();
        if (await inp.isVisible({ timeout: 1000 }).catch(() => false)) {
          await inp.click();
          await inp.fill(stListName);
          nameFilled = true;
          console.log(`  Filled via locator: ${sel}`);
          break;
        }
      }
    }

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-04-name-filled.png`) });

    // Enable re-skip-trace toggle if present
    const reSkipClicked = await page.evaluate(`(function(){
      var els = document.querySelectorAll("label, span, div, p, input[type='checkbox']");
      for (var i = 0; i < els.length; i++) {
        if (/re-skip trace/i.test(els[i].textContent || "")) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            els[i].click();
            return true;
          }
        }
      }
      return false;
    })()`);
    console.log(`  Re-skip-trace toggle: ${reSkipClicked}`);
    await page.waitForTimeout(500);

    // Click Place Order — wait for it to become enabled
    let ordered = false;
    for (let wait = 0; wait < 10; wait++) {
      const orderState = await page.evaluate(`(function(){
        var btns = document.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if (/place order/i.test((btns[i].textContent || "").trim())) {
            var r = btns[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { visible: true, disabled: btns[i].disabled, x: Math.round(r.x), y: Math.round(r.y) };
            }
          }
        }
        return { visible: false };
      })()`);
      console.log(`  Place Order state (attempt ${wait + 1}): ${JSON.stringify(orderState)}`);

      if (orderState?.visible && !orderState?.disabled) {
        await page.mouse.click(orderState.x + 50, orderState.y + 15);
        ordered = true;
        console.log(`  Place Order CLICKED`);
        break;
      }

      if (orderState?.visible && orderState?.disabled) {
        // Try clicking the input again and retyping
        if (fillResult?.found && wait < 3) {
          const ix = fillResult.x + fillResult.w / 2;
          const iy = fillResult.y + fillResult.h / 2;
          await page.mouse.click(ix, iy, { clickCount: 3 });
          await page.waitForTimeout(200);
          await page.keyboard.type(stListName + "-" + wait, { delay: 30 });
          await page.waitForTimeout(500);
        }
      }

      await page.waitForTimeout(1000);
    }

    if (!ordered) {
      console.log(`  FAILED to place skip trace order`);
      // Take screenshot and continue to export (may already have skip trace data from manual)
      await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-05-order-fail.png`) });
      // Dismiss modal
      await dismissModals(page);
      await page.waitForTimeout(1000);
    } else {
      console.log(`  Waiting 45s for skip trace processing...`);
      await page.waitForTimeout(5000);
      // Dismiss any post-order modal/confirmation
      await dismissModals(page);
      await page.waitForTimeout(40000);
    }

    // Reload list page with fresh data
    if (groupId) {
      console.log(`  Reloading list page...`);
      await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await dismissAlerts(page);
    }

    await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-06-after-skip.png`) });

    // ============ EXPORT CSV ============
    // Re-select all rows
    console.log(`  Selecting rows for export...`);
    const headerCells2 = page.locator('.ag-header-cell[col-id="resultIndex"]');
    const hdrCount2 = await headerCells2.count().catch(() => 0);
    for (let hi = 0; hi < hdrCount2; hi++) {
      const box = await headerCells2.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(800);
        break;
      }
    }

    // Open Actions dropdown (visible instance, in the toolbar area)
    console.log(`  Opening Actions dropdown...`);
    const actionsBtns = page.locator("button");
    const actionsTotal = await actionsBtns.count();
    for (let ai = 0; ai < actionsTotal; ai++) {
      const text = await actionsBtns.nth(ai).textContent().catch(() => "");
      const box = await actionsBtns.nth(ai).boundingBox().catch(() => null);
      if (text?.trim() === "Actions" && box && box.width > 0 && box.y > 50 && box.y < 250) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`  Clicked Actions at (${Math.round(box.x)}, ${Math.round(box.y)})`);
        break;
      }
    }
    await page.waitForTimeout(1000);

    // Click Export CSV
    let csvPath: string | null = null;
    const downloadPromise = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    const exportCsv = page.getByText("Export CSV", { exact: true }).last();
    if (await exportCsv.isVisible().catch(() => false)) {
      await exportCsv.click();
      console.log(`  Export CSV clicked`);
    } else {
      // Fallback: find via evaluate
      const exportClicked = await page.evaluate(`(function(){
        var els = document.querySelectorAll("[class*='dropdownItem'] *, [class*='dropdown'] div, [class*='dropdown'] li, [role='menuitem']");
        for (var i = 0; i < els.length; i++) {
          var ownText = "";
          for (var j = 0; j < els[i].childNodes.length; j++) {
            if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
          }
          if (/^export csv$/i.test(ownText.trim())) {
            var r = els[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { els[i].click(); return true; }
          }
        }
        return false;
      })()`);
      console.log(`  Export CSV fallback: ${exportClicked}`);
    }

    const download = await downloadPromise;
    if (download) {
      csvPath = path.join(OUTPUT_DIR, `${listInfo.signal}-reskip.csv`);
      await download.saveAs(csvPath);
      console.log(`  Downloaded: ${csvPath}`);
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      console.log(`  CSV rows: ${lines.length - 1}`);

      // Check for phone data
      const header = lines[0].split(",");
      const phone1Idx = header.findIndex((h: string) => h.trim() === "Phone 1");
      if (phone1Idx >= 0) {
        let withPhone = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          if (cols[phone1Idx]?.trim()) withPhone++;
        }
        console.log(`  Rows with Phone 1 data: ${withPhone} / ${lines.length - 1}`);
      }
    } else {
      console.log(`  WARNING: No CSV downloaded`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `re-skip-${listInfo.signal}-07-export-fail.png`) });
    }

    results.push({
      signal: listInfo.signal,
      listName: listInfo.name,
      groupId,
      ordered,
      csvPath,
    });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("RE-SKIP-TRACE COMPLETE");
  console.log(`${"=".repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.signal}: ordered=${r.ordered}, csv=${r.csvPath || "none"}`);
  }

  await browser.close();
})();
