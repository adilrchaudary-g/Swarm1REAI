import { chromium } from "playwright";
import path from "path";
import os from "os";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = process.env.PROPSTREAM_USERNAME || "";
const PASSWORD = process.env.PROPSTREAM_PASSWORD || "";

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
  });
  const page = browser.pages()[0] || await browser.newPage();

  await page.goto("https://app.propstream.com/property/group/5259904", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  // Login if needed
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  if (await passwordInput.count().catch(() => 0)) {
    const allowAll = page.locator('button:has-text("Accept All"), #accept-recommended-btn-handler').first();
    if (await allowAll.count().catch(() => 0)) await allowAll.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    const usernameInput = page.locator('input[name="username"], input[type="text"]').first();
    await usernameInput.fill(USERNAME).catch(() => undefined);
    await passwordInput.fill(PASSWORD).catch(() => undefined);
    await page.locator('button[type="submit"], .gradient-btn').first().click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(5000);
    await page.goto("https://app.propstream.com/property/group/5259904", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
  }

  // Dismiss alert - with retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const alertCheckbox = page.locator('[class*="Alert-style"] input[type="checkbox"]').first();
    if (await alertCheckbox.count().catch(() => 0)) {
      const checked = await alertCheckbox.isChecked().catch(() => true);
      if (!checked) await alertCheckbox.check({ force: true }).catch(() => undefined);
    }
    const alertClose = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await alertClose.isVisible().catch(() => false)) {
      await alertClose.click({ force: true }).catch(() => undefined);
      console.log("Alert closed! attempt:", attempt);
      await page.waitForTimeout(2000);
    } else {
      break;
    }
  }

  await page.waitForTimeout(2000);

  // Get ALL cells of first row and their positions
  const cells = await page.evaluate(`
    (() => {
      var rows = Array.from(document.querySelectorAll(".ag-center-cols-container .ag-row, .ag-body-viewport .ag-row")).filter(function(r) {
        var rect = r.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (rows.length === 0) {
        // Maybe rows are in a different container
        var allRows = Array.from(document.querySelectorAll(".ag-row"));
        return {
          visibleRows: 0,
          totalRows: allRows.length,
          agBody: document.querySelector(".ag-body-viewport") ? "exists" : "missing",
          agCenter: document.querySelector(".ag-center-cols-container") ? "exists" : "missing",
          agRoot: document.querySelector(".ag-root-wrapper") ? "exists" : "missing",
          firstRowDimensions: allRows.length > 0 ? (function() {
            var r = allRows[0].getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })() : null,
        };
      }

      var firstRow = rows[0];
      var cells = Array.from(firstRow.querySelectorAll(".ag-cell"));

      return {
        visibleRows: rows.length,
        firstRowCells: cells.map(function(cell, i) {
          var rect = cell.getBoundingClientRect();
          return {
            index: i,
            colId: cell.getAttribute("col-id"),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            htmlPreview: cell.innerHTML.slice(0, 200),
            hasCheckbox: cell.querySelector("input[type='checkbox']") !== null,
          };
        }).slice(0, 10),
      };
    })()
  `);

  console.log("Grid cells:");
  console.log(JSON.stringify(cells, null, 2));

  await page.screenshot({ path: path.join(os.tmpdir(), "ps-grid-cells.png"), fullPage: false });
  console.log("\nScreenshot:", path.join(os.tmpdir(), "ps-grid-cells.png"));

  await browser.close();
})();
