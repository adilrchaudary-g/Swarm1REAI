import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
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
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  console.log("Logged in.");

  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);
  await page.evaluate(`(function(){ document.querySelectorAll('[class*="modalOverlay"]').forEach(function(el){ el.remove(); }); document.body.style.overflow = ""; })()`);

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
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  console.log("Filters applied.");

  // Open Actions → Input Range
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  console.log("Input Range UI opened.");

  // Use React-compatible value setter for range inputs
  const setResult = await page.evaluate(`(function(){
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    if (!left || !right) return { error: "inputs not found" };

    // Focus and set left input
    left.focus();
    ns.call(left, "1");
    left.dispatchEvent(new Event("input", { bubbles: true }));
    left.dispatchEvent(new Event("change", { bubbles: true }));

    // Focus and set right input
    right.focus();
    ns.call(right, "224");
    right.dispatchEvent(new Event("input", { bubbles: true }));
    right.dispatchEvent(new Event("change", { bubbles: true }));

    return {
      leftVal: left.value,
      rightVal: right.value,
      leftPlaceholder: left.placeholder,
      rightPlaceholder: right.placeholder
    };
  })()`);
  console.log(`Set range: ${JSON.stringify(setResult)}`);

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "v3-01-range-set.png") });

  // Click "Show Property Range" using Playwright mouse click at exact coordinates
  const showBtn = page.locator("button, span, div, a").filter({ hasText: /Show Property Range/i }).first();
  if (await showBtn.isVisible().catch(() => false)) {
    const box = await showBtn.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      console.log(`Clicked Show Property Range at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
    }
  } else {
    // Find it by evaluate
    console.log("Trying evaluate click...");
    await page.evaluate(`(function(){
      var els = document.querySelectorAll("button, span, div, a");
      for (var i = 0; i < els.length; i++) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
        if (/show property range/i.test(ownText.trim())) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { els[i].click(); return; }
        }
      }
    })()`);
  }
  await page.waitForTimeout(5000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "v3-02-after-show.png") });

  // Check what happened
  const selectedCount = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0; for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) n++; }
    return n;
  })()`);
  console.log(`Selected checkboxes: ${selectedCount}`);

  // Check the "SELECTED" badge text
  const badges = await page.evaluate(`(function(){
    var results = [];
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/selected/i.test(t) && t.length < 30) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 200) results.push(t);
      }
    }
    return results;
  })()`);
  console.log(`Badges: ${JSON.stringify(badges)}`);

  // Try approach 2: use Playwright .fill() on the inputs then click
  console.log("\nAttempt 2: Using Playwright .fill()...");
  const leftInput = page.locator('[class*="inputBoxLeft"]').first();
  const rightInput = page.locator('[class*="inputBoxRight"]').first();

  if (await leftInput.isVisible().catch(() => false)) {
    // Clear and fill using Playwright
    await leftInput.click({ clickCount: 3 });
    await page.waitForTimeout(100);
    await leftInput.fill("1");
    await page.waitForTimeout(300);

    await rightInput.click({ clickCount: 3 });
    await page.waitForTimeout(100);
    await rightInput.fill("224");
    await page.waitForTimeout(300);

    console.log(`Left: ${await leftInput.inputValue()}`);
    console.log(`Right: ${await rightInput.inputValue()}`);

    await page.screenshot({ path: path.join(OUTPUT_DIR, "v3-03-fill-attempt2.png") });

    // Click Show Property Range again
    const showBtn2 = page.getByText("Show Property Range").first();
    if (await showBtn2.isVisible().catch(() => false)) {
      await showBtn2.click();
      console.log("Clicked Show Property Range (attempt 2)");
      await page.waitForTimeout(5000);

      const selected2 = await page.evaluate(`(function(){
        var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
        var n = 0; for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) n++; }
        return n;
      })()`);
      console.log(`Selected after attempt 2: ${selected2}`);

      const badges2 = await page.evaluate(`(function(){
        var results = [];
        var els = document.querySelectorAll("span, div, p");
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || "").trim();
          if (/selected/i.test(t) && t.length < 30) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 200) results.push(t); }
        }
        return results;
      })()`);
      console.log(`Badges: ${JSON.stringify(badges2)}`);

      await page.screenshot({ path: path.join(OUTPUT_DIR, "v3-04-after-attempt2.png") });
    }
  }

  await browser.close();
})();
