import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-test");

function toggleFilterJS(name: string) {
  return `(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(name)}){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`;
}
function expandSectionJS() {
  return `(function(){var els=document.querySelectorAll("h4,div,span,p");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(/value.*equity/i.test(t.trim())){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x<400&&r.x>50){els[i].click();return true}}}return false})()`;
}
function fillRangeJS(label: string, minVal: string | null, maxVal: string | null) {
  return `(function(){var h4s=document.querySelectorAll("h4,h3,h2");var tgt=null;for(var i=0;i<h4s.length;i++){var t="";for(var j=0;j<h4s[i].childNodes.length;j++){if(h4s[i].childNodes[j].nodeType===3)t+=h4s[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(label)}){var r=h4s[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.y>-100){tgt=h4s[i];break}}}if(!tgt)return false;var hr=tgt.getBoundingClientRect();var inps=document.querySelectorAll("input[placeholder='Min'],input[placeholder='Max']");var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;for(var i=0;i<inps.length;i++){var ir=inps[i].getBoundingClientRect();if(ir.width<=0||ir.height<=0)continue;var dy=ir.y-hr.y;var dx=Math.abs(ir.x-hr.x);if(dy>0&&dy<60&&dx<250){if(${minVal?`true`:`false`}&&inps[i].placeholder==="Min"){ns.call(inps[i],${JSON.stringify(minVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}if(${maxVal?`true`:`false`}&&inps[i].placeholder==="Max"){ns.call(inps[i],${JSON.stringify(maxVal||"")});inps[i].dispatchEvent(new Event("input",{bubbles:true}));inps[i].dispatchEvent(new Event("change",{bubbles:true}))}}}return true})()`;
}

async function dismissEverything(page: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const dismissed = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < cbs.length; i++) {
        var label = cbs[i].closest('label') || cbs[i].parentElement;
        if (label && /do not show/i.test(label.textContent || "")) { if (!cbs[i].checked) cbs[i].click(); }
      }
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        if (/^close$/i.test(t)) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { btns[i].click(); return "closed"; } }
      }
      return null;
    })()`);
    if (dismissed) await page.waitForTimeout(1000);
    else break;
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
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  // Search with probate filters
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"]').forEach(function(el){ el.remove(); });
    document.body.style.overflow = "";
  })()`);

  const zipInput = page.locator('div[class*="searchInput"] input, input[placeholder*="Enter" i]').first();
  await zipInput.click({ force: true });
  await zipInput.fill("Cuyahoga County, OH");
  await page.waitForTimeout(1000);
  const suggestion = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) await suggestion.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const filtersBtn = page.getByText(/^filters$/i).first();
  if (await filtersBtn.isVisible().catch(() => false)) { await filtersBtn.click({ force: true }); await page.waitForTimeout(1500); }
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  await page.evaluate(toggleFilterJS("Pre-Probate"));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; }
      if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } }
    }
  })()`);
  await page.waitForTimeout(2000);

  console.log("Filters applied.");

  // Click Actions → Input Range
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; }
      if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } }
    }
  })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } }
    }
  })()`);
  await page.waitForTimeout(2000);

  console.log("Input Range opened.");

  // Use Playwright mouse.click to click the LEFT input field and type "1"
  const leftInput = page.locator('[class*="inputBoxLeft"]').first();
  const rightInput = page.locator('[class*="inputBoxRight"]').first();

  if (await leftInput.isVisible().catch(() => false)) {
    const leftBox = await leftInput.boundingBox();
    const rightBox = await rightInput.boundingBox();
    console.log(`Left input: ${JSON.stringify(leftBox)}`);
    console.log(`Right input: ${JSON.stringify(rightBox)}`);

    // Click and type into left input
    await page.mouse.click(leftBox!.x + leftBox!.width / 2, leftBox!.y + leftBox!.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.type("1", { delay: 50 });
    await page.waitForTimeout(300);

    // Click and type into right input
    await page.mouse.click(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.type("224", { delay: 50 });
    await page.waitForTimeout(500);

    console.log("Range typed: 1 to 224");
  } else {
    console.log("Input Range inputs not found via locator — trying evaluate");
    // Fallback: use evaluate with the class names
    await page.evaluate(`(function(){
      var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      var left = document.querySelector('[class*="inputBoxLeft"]');
      var right = document.querySelector('[class*="inputBoxRight"]');
      if (left) { ns.call(left, "1"); left.dispatchEvent(new Event("input", {bubbles:true})); left.dispatchEvent(new Event("change", {bubbles:true})); }
      if (right) { ns.call(right, "224"); right.dispatchEvent(new Event("input", {bubbles:true})); right.dispatchEvent(new Event("change", {bubbles:true})); }
    })()`);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "v2-01-range-typed.png") });

  // Click "Show Property Range" button
  console.log("Clicking Show Property Range...");
  const showRangeClicked = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, span, div, a");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; }
      if (/show property range/i.test(ownText.trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { btns[i].click(); return { text: ownText.trim(), x: Math.round(r.x), y: Math.round(r.y) }; }
      }
    }
    return null;
  })()`);
  console.log(`  Clicked: ${JSON.stringify(showRangeClicked)}`);
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "v2-02-after-show-range.png") });

  // Check: how many results are now selected / showing?
  const selectedCount = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) n++; }
    return n;
  })()`);
  console.log(`Selected checkboxes: ${selectedCount}`);

  const selectedBadge = await page.evaluate(`(function(){
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/\\d+\\s*SELECTED/i.test(t) && t.length < 30) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 200) return t;
      }
    }
    return null;
  })()`);
  console.log(`Badge: ${selectedBadge}`);

  // Now save: Actions → Save
  console.log("\nSaving...");
  const listName = `range-test-${Date.now()}`;

  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; }
      if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } }
    }
  })()`);
  await page.waitForTimeout(800);

  await page.evaluate(`(function(){
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/^save$/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } }
    }
  })()`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "v2-03-save-modal.png") });

  // Fill list name and create
  const listInput = page.locator('[placeholder*="Select or Type"]').first();
  if (await listInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await listInput.click();
    await page.waitForTimeout(300);
    await listInput.fill(listName);
    await page.waitForTimeout(800);

    // Create new list
    await page.evaluate(`(function(){
      var best = null; var bestArea = Infinity;
      var els = document.querySelectorAll("div, span, li, a, p");
      for (var i = 0; i < els.length; i++) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
        if (/create.*new.*list/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); var area = r.width * r.height; if (r.width > 0 && r.height > 0 && area < bestArea) { best = els[i]; bestArea = area; } }
      }
      if (best) best.click();
    })()`);
    await page.waitForTimeout(500);

    // Click Save
    await page.evaluate(`(function(){
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        var r = btns[i].getBoundingClientRect();
        if (/^save$/i.test(t) && r.width > 0 && r.height > 0 && r.y > 100 && r.y < 600 && !btns[i].disabled) { btns[i].click(); return; }
      }
    })()`);
    console.log(`Saved to "${listName}"`);
    await page.waitForTimeout(5000);
  } else {
    console.log("Save modal not visible");
  }

  // Navigate to My Properties and check the list count
  console.log("\nChecking list...");
  await page.goto("https://app.propstream.com/property/group/0", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissEverything(page);
  await page.waitForTimeout(2000);

  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await page.evaluate(`(function(){
      var name = ${JSON.stringify(listName)};
      var labels = document.querySelectorAll('[class*="labelName"]');
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].textContent || "").replace(/\\s+/g, " ").trim();
        if (t.startsWith(name.substring(0, 10))) {
          var parent = labels[i].closest('[class*="labelItem"]') || labels[i].parentElement;
          var context = parent ? (parent.textContent || "").replace(/\\s+/g, " ").trim() : "";
          return { name: t, context: context.slice(0, 100) };
        }
      }
      return null;
    })()`);
    if (found) {
      console.log(`Found: ${JSON.stringify(found)}`);
      break;
    }
    await page.evaluate(`(function(){
      var panels = document.querySelectorAll('[class*="LeftPanel"], [class*="leftPanel"]');
      for (var i = 0; i < panels.length; i++) { var r = panels[i].getBoundingClientRect(); if (r.width > 50 && r.height > 100 && r.x < 400) panels[i].scrollTop += 300; }
    })()`);
    await page.waitForTimeout(1000);
  }

  await browser.close();
})();
