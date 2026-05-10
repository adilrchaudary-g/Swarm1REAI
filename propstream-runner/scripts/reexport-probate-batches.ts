import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
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
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  // Step 1: Go to My Properties and discover all probate-batch list group IDs
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await dismissEverything(page);

  // Scroll through sidebar to find all probate-batch lists
  const discovered: { name: string; groupId: string }[] = [];

  for (let scrollAttempt = 0; scrollAttempt < 30; scrollAttempt++) {
    const found = await page.evaluate(`(function(){
      var results = [];
      var labels = document.querySelectorAll('[class*="labelName"]');
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (/^probate-batch-p\\d+-\\d+$/.test(t)) {
          results.push(t);
        }
      }
      return results;
    })()`);

    for (const name of found) {
      if (!discovered.some(d => d.name === name)) {
        // Click this label to get its group ID
        const clicked = await page.evaluate(`(function(){
          var labels = document.querySelectorAll('[class*="labelName"]');
          for (var i = 0; i < labels.length; i++) {
            var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
            if (t === ${JSON.stringify(name)}) { labels[i].click(); return true; }
          }
          return false;
        })()`);

        if (clicked) {
          await page.waitForTimeout(2000);
          const m = page.url().match(/property\/group\/[^/]*\/(\d+)/);
          if (m) {
            discovered.push({ name, groupId: m[1] });
            console.log(`  Found: ${name} → group ${m[1]}`);
          } else {
            const url = page.url();
            const m2 = url.match(/property\/group\/(\d+)/);
            if (m2 && m2[1] !== "0") {
              discovered.push({ name, groupId: m2[1] });
              console.log(`  Found: ${name} → group ${m2[1]}`);
            } else {
              console.log(`  Found label "${name}" but couldn't extract group ID from URL: ${url}`);
            }
          }
          // Go back to list view
          await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(3000);
          await dismissEverything(page);
        }
      }
    }

    // If we found 5 lists, we're done
    if (discovered.length >= 5) break;

    // Scroll the sidebar panel down
    await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
    await page.waitForTimeout(1000);
  }

  console.log(`\nDiscovered ${discovered.length} probate batch lists:`);
  for (const d of discovered) console.log(`  ${d.name} → ${d.groupId}`);

  if (discovered.length === 0) {
    console.log("No probate batch lists found! Trying alternative: look for any list with 'probate' in the name...");
    // Broader search
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    for (let scrollAttempt = 0; scrollAttempt < 30; scrollAttempt++) {
      const allLabels = await page.evaluate(`(function(){
        var results = [];
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (/probate/i.test(t)) results.push(t);
        }
        return results;
      })()`);
      console.log(`  Scroll ${scrollAttempt}: probate lists visible: ${JSON.stringify(allLabels)}`);

      await page.evaluate(`(function(){ var p = document.querySelectorAll('[class*="LeftPanel"]'); for (var i = 0; i < p.length; i++) { var r = p[i].getBoundingClientRect(); if (r.width > 50 && r.x < 400) p[i].scrollTop += 300; } })()`);
      await page.waitForTimeout(1000);
    }

    await browser.close();
    process.exit(1);
  }

  // Sort by page number
  discovered.sort((a, b) => {
    const pa = parseInt(a.name.match(/-p(\d+)-/)?.[1] || "0");
    const pb = parseInt(b.name.match(/-p(\d+)-/)?.[1] || "0");
    return pa - pb;
  });

  // Step 2: Export each list
  console.log(`\n${"=".repeat(50)}`);
  console.log("EXPORTING PROBATE BATCHES");
  console.log(`${"=".repeat(50)}`);

  const csvPaths: string[] = [];

  for (let i = 0; i < discovered.length; i++) {
    const { name, groupId } = discovered[i];
    const pageNum = parseInt(name.match(/-p(\d+)-/)?.[1] || `${i + 1}`);

    console.log(`\nExporting "${name}" (group ${groupId})...`);
    await page.goto(`https://app.propstream.com/property/group/${groupId}`, {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await page.waitForTimeout(5000);
    await dismissEverything(page);

    // Select header checkbox
    const hdr = page.locator('.ag-header-cell[col-id="resultIndex"]');
    for (let hi = 0; hi < await hdr.count().catch(() => 0); hi++) {
      const box = await hdr.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(800);
        break;
      }
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
    else {
      await page.evaluate(`(function(){
        var els = document.querySelectorAll("[class*='dropdownItem'] *, [class*='dropdown'] div, li, [role='menuitem']");
        for (var i = 0; i < els.length; i++) {
          var ownText = "";
          for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
          if (/^export csv$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } }
        }
      })()`);
    }

    const dl = await dlPromise;
    if (dl) {
      const csvPath = path.join(OUTPUT_DIR, `probate-p${pageNum}.csv`);
      await dl.saveAs(csvPath);
      csvPaths.push(csvPath);

      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      const header = lines[0].split(",");
      const phoneIdx = header.findIndex((h: string) => h.trim() === "Phone 1");
      let withPhone = 0;
      for (let li = 1; li < lines.length; li++) {
        const cols = lines[li].split(",");
        if (cols[phoneIdx]?.trim()) withPhone++;
      }
      console.log(`  ${lines.length - 1} rows, ${withPhone} with phone (${Math.round((withPhone / Math.max(1, lines.length - 1)) * 100)}%)`);
    } else {
      console.log(`  No download received`);
    }
  }

  // Merge
  if (csvPaths.length > 0) {
    console.log("\nMerging CSVs...");
    const mergedPath = path.join(OUTPUT_DIR, "probate-final.csv");
    let headerLine = "";
    const allRows: string[] = [];
    const seen = new Set<string>();

    for (const csvPath of csvPaths) {
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      if (!headerLine) headerLine = lines[0];
      for (const row of lines.slice(1)) {
        const addr = row.split(",").slice(0, 3).join(",");
        if (!seen.has(addr)) {
          seen.add(addr);
          allRows.push(row);
        }
      }
    }

    fs.writeFileSync(mergedPath, headerLine + "\n" + allRows.join("\n") + "\n");
    const phoneIdx = headerLine.split(",").findIndex((h: string) => h.trim() === "Phone 1");
    let totalWithPhone = 0;
    for (const row of allRows) {
      const cols = row.split(",");
      if (cols[phoneIdx]?.trim()) totalWithPhone++;
    }
    console.log(`Merged: ${allRows.length} unique rows, ${totalWithPhone} with phone (${Math.round((totalWithPhone / Math.max(1, allRows.length)) * 100)}%)`);
    console.log(`Output: ${mergedPath}`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("DONE");
  console.log(`${"=".repeat(50)}`);

  await browser.close();
})();
