import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

async function dismissEverything(page: any) {
  // 1. PropStream "Updates" splash modal
  for (let attempt = 0; attempt < 3; attempt++) {
    const dismissed = await page.evaluate(`(function(){
      // Check "Do not show this message again" checkbox
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < cbs.length; i++) {
        var label = cbs[i].closest('label') || cbs[i].parentElement;
        if (label && /do not show/i.test(label.textContent || "")) {
          if (!cbs[i].checked) cbs[i].click();
        }
      }
      // Click Close button
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
    if (dismissed) {
      console.log(`  Dismissed modal: ${dismissed}`);
      await page.waitForTimeout(1000);
    } else break;
  }

  // 2. Alert-style notifications
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

  // 3. Generic modals (OK, Done, Got it)
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (/^(ok|done|got it|×)$/i.test((btns[i].textContent || "").trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(500);
}

async function exportList(page: any, outputPath: string): Promise<{ rows: number; withPhone: number } | null> {
  // Select header checkbox
  const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
  const hdrCount = await headerCells.count().catch(() => 0);
  for (let hi = 0; hi < hdrCount; hi++) {
    const box = await headerCells.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(800);
      break;
    }
  }

  // Actions dropdown
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
    console.log("  Export CSV clicked");
  } else {
    console.log("  Export CSV not visible");
    await page.screenshot({ path: outputPath.replace(".csv", "-dropdown-fail.png") });
    return null;
  }

  const download = await downloadPromise;
  if (!download) {
    console.log("  No download received");
    return null;
  }

  await download.saveAs(outputPath);
  const content = fs.readFileSync(outputPath, "utf-8");
  const lines = content.split("\n").filter((l: string) => l.trim());
  const header = lines[0].split(",");
  const phone1Idx = header.findIndex((h: string) => h.trim() === "Phone 1");
  let withPhone = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[phone1Idx]?.trim()) withPhone++;
  }

  return { rows: lines.length - 1, withPhone };
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

  // Check probate-full list
  const groupId = "5260036"; // harvest-probate-full
  console.log(`\n--- harvest-probate-full (group ${groupId}) ---`);
  await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "probate-full-check2.png") });

  // Read stats
  const stats = await page.evaluate(`(function(){
    // Find the list name and count in the sidebar
    var labels = document.querySelectorAll('[class*="labelName"]');
    var listInfo = null;
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").trim();
      if (/probate-full/i.test(t)) listInfo = t;
    }
    // Count AG-Grid rows
    var agRows = document.querySelectorAll('.ag-row').length;
    // Read header stats
    var statItems = [];
    var els = document.querySelectorAll('[class*="headerColLink"], [class*="statsItem"]');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").replace(/\\s+/g, " ").trim();
      if (t.length > 0 && t.length < 40) statItems.push(t);
    }
    return { listInfo, agRows, statItems: statItems.slice(0, 20) };
  })()`);
  console.log("Stats:", JSON.stringify(stats));

  const result = await exportList(page, path.join(OUTPUT_DIR, "probate-full-v2.csv"));
  if (result) {
    console.log(`Result: ${result.rows} rows, ${result.withPhone} with phone data`);
  }

  // Also check old probate list
  console.log(`\n--- Old probate (group 5260019) ---`);
  await page.goto(`https://app.propstream.com/property/group/5260019`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  const result2 = await exportList(page, path.join(OUTPUT_DIR, "probate-old-v2.csv"));
  if (result2) {
    console.log(`Result: ${result2.rows} rows, ${result2.withPhone} with phone data`);
  }

  // Also re-check pre_foreclosure and tax_delinquent to see if phone counts changed
  console.log(`\n--- Re-check pre_foreclosure (group 5260011) ---`);
  await page.goto(`https://app.propstream.com/property/group/5260011`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  const result3 = await exportList(page, path.join(OUTPUT_DIR, "pre_foreclosure-v2.csv"));
  if (result3) {
    console.log(`Result: ${result3.rows} rows, ${result3.withPhone} with phone data`);
  }

  await browser.close();
})();
