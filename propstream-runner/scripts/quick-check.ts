import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

(async () => {
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
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  // Check the latest probate list
  const listsToCheck = [
    { name: "harvest-probate-full", signal: "probate-full" },
    { name: "harvest-probate-1777729447047", signal: "probate-old", groupId: "5260019" },
  ];

  // Navigate to My Properties to find the full list
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Dismiss alerts
  for (let attempt = 0; attempt < 3; attempt++) {
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

  // Find the harvest-probate-full list
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await page.evaluate(`(function(){
      var labels = document.querySelectorAll('[class*="labelName"]');
      var results = [];
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t.includes("probate")) results.push(t);
      }
      return results;
    })()`);
    if (found.length > 0) {
      console.log("Probate lists found:", found);
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

  // Click on the harvest-probate-full list
  const clicked = await page.evaluate(`(function(){
    var labels = document.querySelectorAll('[class*="labelName"]');
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
      if (t.startsWith("harvest-probate-full")) {
        labels[i].click();
        return t;
      }
    }
    return null;
  })()`);
  console.log("Clicked:", clicked);
  await page.waitForTimeout(3000);

  const url = page.url();
  const m = url.match(/property\/group\/[^/]+\/(\d+)/);
  if (m) {
    const groupId = m[1];
    console.log("Group ID:", groupId);
    await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    // Read the total from header
    const headerText = await page.evaluate(`(function(){
      var els = document.querySelectorAll("*");
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || "").trim();
        if (/^Total\\s+\\d/.test(t) && t.length < 200) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.y < 200) return t.slice(0, 100);
        }
      }
      return "not found";
    })()`);
    console.log("Header:", headerText);

    // Screenshot
    await page.screenshot({ path: path.join(OUTPUT_DIR, "probate-full-check.png") });

    // Now re-export this list
    console.log("\nRe-exporting...");

    // Select header checkbox
    const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
    for (let hi = 0; hi < await headerCells.count().catch(() => 0); hi++) {
      const box = await headerCells.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(800);
        break;
      }
    }

    // Actions → Export CSV
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
      const csvPath = path.join(OUTPUT_DIR, "probate-full-recheck.csv");
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
      console.log(`CSV: ${lines.length - 1} rows, ${withPhone} with phone data`);
    } else {
      console.log("No download received");
    }
  }

  // Also check the OLD probate list (group 5260019) to see if skip trace populated
  console.log("\n--- Checking old probate list (group 5260019) ---");
  await page.goto("https://app.propstream.com/property/group/5260019", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Dismiss alerts
  for (let attempt = 0; attempt < 3; attempt++) {
    const close = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2000);
    } else break;
  }

  // Select + export
  const headerCells2 = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await headerCells2.count().catch(() => 0); hi++) {
    const box = await headerCells2.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(800);
      break;
    }
  }

  const actionsBtns2 = page.locator("button");
  const actionsTotal2 = await actionsBtns2.count();
  for (let ai = 0; ai < actionsTotal2; ai++) {
    const text = await actionsBtns2.nth(ai).textContent().catch(() => "");
    const box = await actionsBtns2.nth(ai).boundingBox().catch(() => null);
    if (text?.trim() === "Actions" && box && box.width > 0 && box.y > 50 && box.y < 250) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.waitForTimeout(1500);

  const downloadPromise2 = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  const exportCsv2 = page.getByText("Export CSV", { exact: true }).last();
  if (await exportCsv2.isVisible().catch(() => false)) {
    await exportCsv2.click();
    console.log("Export CSV clicked (old probate)");
  }

  const download2 = await downloadPromise2;
  if (download2) {
    const csvPath = path.join(OUTPUT_DIR, "probate-old-recheck.csv");
    await download2.saveAs(csvPath);
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n").filter((l: string) => l.trim());
    const header = lines[0].split(",");
    const phone1Idx = header.findIndex((h: string) => h.trim() === "Phone 1");
    let withPhone = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols[phone1Idx]?.trim()) withPhone++;
    }
    console.log(`Old probate CSV: ${lines.length - 1} rows, ${withPhone} with phone data`);
  }

  await browser.close();
})();
