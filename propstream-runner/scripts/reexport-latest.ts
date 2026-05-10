import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

const LISTS = [
  { signal: "pre_foreclosure", groupId: "5260011", expectedRows: 450 },
  { signal: "tax_delinquent", groupId: "5260014", expectedRows: 900 },
  { signal: "probate", groupId: "5260019", expectedRows: 50 },
];

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

  for (const list of LISTS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`EXPORT: ${list.signal} (group ${list.groupId}, expect ${list.expectedRows} rows)`);
    console.log(`${"=".repeat(60)}`);

    // Navigate directly to the list
    await page.goto(`https://app.propstream.com/property/group/${list.groupId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

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
    await page.waitForTimeout(1000);

    // Select all rows via header checkbox (Playwright mouse.click for AG-Grid)
    console.log(`  Selecting all rows...`);
    const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
    const hdrCount = await headerCells.count().catch(() => 0);
    let headerClicked = false;
    for (let hi = 0; hi < hdrCount; hi++) {
      const box = await headerCells.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) {
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        await page.waitForTimeout(1000);
        headerClicked = true;
        console.log(`  Header checkbox at (${Math.round(box.x + 12)}, ${Math.round(box.y + box.height / 2)})`);
        break;
      }
    }
    if (!headerClicked) {
      console.log(`  WARNING: Header checkbox not found`);
    }

    // Open Actions dropdown
    console.log(`  Opening Actions...`);
    const actionsBtns = page.locator("button");
    const actionsTotal = await actionsBtns.count();
    for (let ai = 0; ai < actionsTotal; ai++) {
      const text = await actionsBtns.nth(ai).textContent().catch(() => "");
      const box = await actionsBtns.nth(ai).boundingBox().catch(() => null);
      if (text?.trim() === "Actions" && box && box.width > 0 && box.y > 50 && box.y < 250) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`  Actions at (${Math.round(box.x)}, ${Math.round(box.y)})`);
        break;
      }
    }
    await page.waitForTimeout(1500);

    // Screenshot the dropdown
    await page.screenshot({ path: path.join(OUTPUT_DIR, `reexport-${list.signal}-01-dropdown.png`) });

    // Click Export CSV
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
    const exportCsv = page.getByText("Export CSV", { exact: true }).last();
    if (await exportCsv.isVisible().catch(() => false)) {
      await exportCsv.click();
      console.log(`  Export CSV clicked`);
    } else {
      // Fallback
      const exportClicked = await page.evaluate(`(function(){
        var els = document.querySelectorAll("[class*='dropdownItem'] *, [class*='dropdown'] div, li, [role='menuitem']");
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
      const csvPath = path.join(OUTPUT_DIR, `${list.signal}-final.csv`);
      await download.saveAs(csvPath);
      console.log(`  Downloaded: ${csvPath}`);

      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      const header = lines[0].split(",");
      const phone1Idx = header.findIndex((h: string) => h.trim() === "Phone 1");

      let withPhone = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols[phone1Idx]?.trim()) withPhone++;
      }

      console.log(`  CSV rows: ${lines.length - 1}`);
      console.log(`  Rows with Phone 1: ${withPhone} / ${lines.length - 1}`);
      console.log(`  Phone hit rate: ${Math.round((withPhone / (lines.length - 1)) * 100)}%`);
      const size = fs.statSync(csvPath).size;
      console.log(`  File size: ${Math.round(size / 1024)}KB`);
    } else {
      console.log(`  WARNING: No CSV downloaded`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `reexport-${list.signal}-02-fail.png`) });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("RE-EXPORT COMPLETE");
  console.log(`${"=".repeat(60)}`);

  await browser.close();
})();
