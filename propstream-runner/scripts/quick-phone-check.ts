import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

const GROUP_ID = "5260053"; // probate-batch-p1 (skip traced ~45 min ago)

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome", viewport: { width: 1400, height: 900 }, acceptDownloads: true,
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

  // Quick export of probate-p1 to check phone data
  await page.goto(`https://app.propstream.com/property/group/${GROUP_ID}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Dismiss
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) { if (/^close$/i.test((btns[i].textContent || "").trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) btns[i].click(); } }
  })()`);
  await page.waitForTimeout(1000);

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

  const dlPromise = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  const exportCsv = page.getByText("Export CSV", { exact: true }).last();
  if (await exportCsv.isVisible().catch(() => false)) await exportCsv.click();

  const dl = await dlPromise;
  if (dl) {
    const csvPath = path.join(OUTPUT_DIR, "probate-phone-check.csv");
    await dl.saveAs(csvPath);
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n").filter((l: string) => l.trim());
    const header = lines[0].split(",");
    const phoneIdx = header.findIndex((h: string) => h.trim() === "Phone 1");
    let withPhone = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols[phoneIdx]?.trim()) withPhone++;
    }
    console.log(`Phone check: ${withPhone}/${lines.length - 1} rows have Phone 1 (${Math.round((withPhone / Math.max(1, lines.length - 1)) * 100)}%)`);
  } else {
    console.log("No download");
  }

  await browser.close();
})();
