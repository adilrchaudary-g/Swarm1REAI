import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

const LIST_NAME = "probate-all-1777735622643";
const GROUP_ID = "5260098";
const SIGNAL = "probate";

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
}

async function dismissModals(page: any) {
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (/^(close|ok|done|got it|×|x)$/i.test((btns[i].textContent || "").trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50) { btns[i].click(); return; }
      }
    }
  })()`);
}

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
  console.log("Logged in.");

  // Navigate to the list
  console.log(`\nNavigating to list ${LIST_NAME} (group ${GROUP_ID})...`);
  await page.goto(`https://app.propstream.com/property/group/${GROUP_ID}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await dismissEverything(page);

  // Verify list count
  const count = await page.evaluate(`(function(){
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      var m = ownText.trim().match(/^Total\\s*(\\d+)/i);
      if (m) return parseInt(m[1]);
    }
    return 0;
  })()`);
  console.log(`List has ${count} properties.`);

  // Select all rows via header checkbox
  console.log("Selecting all rows...");
  const hdrCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let hi = 0; hi < await hdrCells.count().catch(() => 0); hi++) {
    const box = await hdrCells.nth(hi).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(500);
      break;
    }
  }

  // Click Skip Trace button
  console.log("Opening Skip Trace...");
  const skipBtns = page.locator("button").filter({ hasText: /^Skip Trace$/ });
  for (let si = 0; si < await skipBtns.count(); si++) {
    const box = await skipBtns.nth(si).boundingBox().catch(() => null);
    if (box && box.width > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.waitForTimeout(3000);

  // Handle "in progress" blocker
  const inProgress = await page.evaluate(`(function(){ var els = document.querySelectorAll("*"); for (var i = 0; i < els.length; i++) { if (/skip trace in progress/i.test(els[i].textContent || "")) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return true; } } return false; })()`);
  if (inProgress) {
    console.log("Skip trace in progress — waiting 2 min...");
    await dismissModals(page);
    await page.waitForTimeout(120000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await dismissEverything(page);
    // Re-select + re-click
    for (let hi = 0; hi < await hdrCells.count().catch(() => 0); hi++) {
      const box = await hdrCells.nth(hi).boundingBox().catch(() => null);
      if (box && box.width > 0 && box.x > 10) { await page.mouse.click(box.x + 12, box.y + box.height / 2); await page.waitForTimeout(500); break; }
    }
    for (let si = 0; si < await skipBtns.count(); si++) {
      const box = await skipBtns.nth(si).boundingBox().catch(() => null);
      if (box && box.width > 0) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); break; }
    }
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, `${SIGNAL}-skip-modal.png`) });

  // Fill skip trace list name via coordinates
  const stName = `st-${SIGNAL}-all-${Date.now()}`;
  const inputInfo = await page.evaluate(`(function(){
    var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      var ph = (inputs[i].placeholder || "").toLowerCase();
      if (r.width > 100 && r.height > 20 && r.y > 100 && r.y < 500 && (ph.includes("list") || ph.includes("name") || ph.includes("enter"))) {
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      }
    }
    return null;
  })()`);
  if (inputInfo) {
    await page.mouse.click(inputInfo.x, inputInfo.y, { clickCount: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.type(stName, { delay: 20 });
    console.log(`Skip trace name: ${stName}`);
    await page.waitForTimeout(500);
  } else {
    console.log("WARNING: Skip trace name input not found!");
  }

  // Enable Re-Skip Trace toggle
  await page.evaluate(`(function(){ var els = document.querySelectorAll("label, span, div"); for (var i = 0; i < els.length; i++) { if (/re-skip trace/i.test(els[i].textContent || "")) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(300);

  // Place Order
  let ordered = false;
  for (let wait = 0; wait < 12; wait++) {
    const os = await page.evaluate(`(function(){ var btns = document.querySelectorAll("button"); for (var i = 0; i < btns.length; i++) { if (/place order/i.test((btns[i].textContent||"").trim())) { var r = btns[i].getBoundingClientRect(); if (r.width>0&&r.height>0) return { v:true, d:btns[i].disabled, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) }; } } return { v:false }; })()`);
    if (os?.v && !os?.d) {
      await page.mouse.click(os.x, os.y);
      ordered = true;
      console.log("Place Order CLICKED!");
      await page.waitForTimeout(5000);
      await dismissModals(page);
      break;
    }
    console.log(`  Waiting for Place Order to enable (attempt ${wait + 1}/12)...`);
    await page.waitForTimeout(1500);
  }

  if (!ordered) {
    console.log("ERROR: Place Order failed!");
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${SIGNAL}-order-fail.png`) });
    await browser.close();
    return;
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, `${SIGNAL}-ordered.png`) });

  // Wait for skip trace to process
  console.log("\nWaiting 5 minutes for skip trace to process...");
  await page.waitForTimeout(300000);

  // Export
  console.log("\nExporting...");
  await page.goto(`https://app.propstream.com/property/group/${GROUP_ID}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await dismissEverything(page);

  // Select all
  for (let hi = 0; hi < await hdrCells.count().catch(() => 0); hi++) {
    const box = await hdrCells.nth(hi).boundingBox().catch(() => null);
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

  const dlPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  const exportCsv = page.getByText("Export CSV", { exact: true }).last();
  if (await exportCsv.isVisible().catch(() => false)) await exportCsv.click();

  const dl = await dlPromise;
  if (dl) {
    const csvPath = path.join(OUTPUT_DIR, `${SIGNAL}-final.csv`);
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
    console.log(`\n${"=".repeat(60)}`);
    console.log(`EXPORT COMPLETE`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Rows: ${lines.length - 1}`);
    console.log(`With phone: ${withPhone} (${Math.round((withPhone / Math.max(1, lines.length - 1)) * 100)}%)`);
    console.log(`File: ${csvPath}`);
  } else {
    console.log("ERROR: No download received");
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${SIGNAL}-export-fail.png`) });
  }

  await browser.close();
  console.log("\nDone.");
})();
