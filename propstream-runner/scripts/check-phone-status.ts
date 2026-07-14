import { chromium } from "playwright";
import path from "path";
import os from "os";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";

const LISTS = [
  { name: "pre_foreclosure", groupId: "5260011" },
  { name: "tax_delinquent", groupId: "5260014" },
  { name: "probate-p1", groupId: "5260053" },
  { name: "probate-p2", groupId: "5260056" },
  { name: "probate-p3", groupId: "5260057" },
  { name: "probate-p4", groupId: "5260058" },
  { name: "probate-p5", groupId: "5260061" },
];

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome", viewport: { width: 1400, height: 900 },
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
  console.log("Logged in.\n");

  for (const list of LISTS) {
    await page.goto(`https://app.propstream.com/property/group/${list.groupId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    // Dismiss alerts
    await page.evaluate(`(function(){
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) { if (/^close$/i.test((btns[i].textContent || "").trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) btns[i].click(); } }
    })()`);
    await page.waitForTimeout(1000);

    // Check AG-Grid for phone column data
    const result = await page.evaluate(`(function(){
      var rows = document.querySelectorAll('.ag-row');
      var total = 0;
      var withPhone = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        total++;
        var cells = rows[i].querySelectorAll('.ag-cell');
        for (var j = 0; j < cells.length; j++) {
          var colId = cells[j].getAttribute('col-id') || '';
          if (/phone/i.test(colId)) {
            var val = (cells[j].textContent || '').trim();
            if (val && val !== '-' && val.length > 5) { withPhone++; break; }
          }
        }
      }
      // Also check total count from header/badge
      var countEls = document.querySelectorAll('span, div, p');
      var totalInList = '';
      for (var i = 0; i < countEls.length; i++) {
        var t = (countEls[i].textContent || '').trim();
        if (/^\\d+\\s*(properties|results)/i.test(t)) { totalInList = t; break; }
        if (/total.*\\d+/i.test(t) && t.length < 30) { totalInList = t; break; }
      }
      return { visibleRows: total, withPhone: withPhone, totalLabel: totalInList };
    })()`);

    console.log(`${list.name} (${list.groupId}): ${result.visibleRows} visible, ${result.withPhone} with phone | ${result.totalLabel || 'no count label'}`);
  }

  await browser.close();
  console.log("\nDone.");
})();
