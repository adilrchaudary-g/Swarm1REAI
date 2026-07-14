import { chromium } from "playwright";
import path from "path";
import os from "os";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
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

  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Dismiss alerts
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

  // Check the latest harvest lists — click each one and read the total count
  const harvestLists = [
    "harvest-pre_foreclosure-1777728444742",
    "harvest-tax_delinquent-1777728796343",
    "harvest-probate-1777729447047",
  ];

  for (const listName of harvestLists) {
    console.log(`\n--- ${listName} ---`);
    await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Find and click the list — scroll through sidebar
    let found = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const labelClicked = await page.evaluate(`(function(){
        var listName = ${JSON.stringify(listName)};
        var labels = document.querySelectorAll('[class*="labelName"]');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (t === listName) {
            labels[i].click();
            return t;
          }
        }
        return null;
      })()`);

      if (labelClicked) {
        found = true;
        await page.waitForTimeout(2000);
        const url = page.url();
        const m = url.match(/property\/group\/[^/]+\/(\d+)/);
        if (m) {
          const groupId = m[1];
          await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(4000);

          // Read stats from the header
          const stats = await page.evaluate(`(function(){
            var result = {};
            var cells = document.querySelectorAll('[class*="statsItem"], [class*="StatsItem"], [class*="stat"]');
            for (var i = 0; i < cells.length; i++) {
              var t = (cells[i].textContent || "").trim();
              if (t.length < 50) result["cell_" + i] = t;
            }
            // Also read the toolbar stat boxes
            var divs = document.querySelectorAll('div');
            for (var i = 0; i < divs.length; i++) {
              var t = (divs[i].textContent || "").trim();
              if (/^Total\\s*\\d/i.test(t)) { result.total = t; break; }
            }
            // Read the AG-Grid row count
            var rows = document.querySelectorAll('.ag-row');
            result.agGridRows = rows.length;
            // Read total from the large stat number
            var nums = document.querySelectorAll('[class*="statsNumber"], [class*="StatsNumber"]');
            for (var i = 0; i < nums.length; i++) {
              result["num_" + i] = nums[i].textContent;
            }
            return result;
          })()`);
          console.log(`  Group ID: ${groupId}`);
          console.log(`  Stats: ${JSON.stringify(stats)}`);
          console.log(`  URL: ${page.url()}`);

          // Read the stat header row
          const headerText = await page.evaluate(`(function(){
            var row = document.querySelector('[class*="statsTitleRow"], [class*="StatsRow"]');
            if (row) return (row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200);
            // Fallback: read the top area
            var els = document.querySelectorAll("th, td, span, div");
            var result = [];
            for (var i = 0; i < els.length; i++) {
              var r = els[i].getBoundingClientRect();
              if (r.y > 30 && r.y < 120 && r.x > 350 && r.width > 30) {
                var t = (els[i].textContent || "").replace(/\\s+/g, " ").trim();
                if (t.length > 0 && t.length < 30 && !result.includes(t)) result.push(t);
              }
            }
            return result.join(" | ");
          })()`);
          console.log(`  Header: ${headerText}`);
        }
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
      await page.waitForTimeout(1000);
    }
    if (!found) console.log("  NOT FOUND");
  }

  // Also check the skip trace status page
  console.log("\n--- Skip Trace Order History ---");
  await page.goto("https://app.propstream.com/account/skip-trace", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(5000);

  const stPage = await page.evaluate(`(function(){
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || "").slice(0, 3000)
    };
  })()`);
  console.log(`  URL: ${stPage.url}`);
  console.log(`  Body:\n${stPage.text}`);

  await browser.close();
})();
