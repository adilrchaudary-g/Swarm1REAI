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
      for (var i = 0; i < cbs.length; i++) {
        var label = cbs[i].closest('label') || cbs[i].parentElement;
        if (label && /do not show/i.test(label.textContent || "")) {
          if (!cbs[i].checked) cbs[i].click();
        }
      }
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
    if (dismissed) await page.waitForTimeout(1000);
    else break;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const close = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2000);
    } else break;
  }
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

  // Search with probate filters
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissEverything(page);

  // Force-dismiss modals
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"], [class*="ModalOverlay"]').forEach(function(el){ el.remove(); });
    document.querySelectorAll('[class*="modalWrapper"], [class*="ModalWrapper"]').forEach(function(el){ el.remove(); });
    document.body.classList.remove("bodyModal"); document.body.style.overflow = "";
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
  if (await filtersBtn.isVisible().catch(() => false)) {
    await filtersBtn.click({ force: true });
    await page.waitForTimeout(1500);
  }
  await page.evaluate(toggleFilterJS("Vacant"));
  await page.waitForTimeout(300);
  await page.evaluate(toggleFilterJS("Pre-Probate"));
  await page.waitForTimeout(300);
  await page.evaluate(expandSectionJS());
  await page.waitForTimeout(800);
  await page.evaluate(fillRangeJS("Estimated Value", null, "500000"));
  await page.evaluate(fillRangeJS("Estimated Equity %", "50", null));
  await page.waitForTimeout(500);

  // Close filter panel
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, span, a");
    for (var i = 0; i < btns.length; i++) {
      var t = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent;
      }
      if (/^filters$/i.test(t.trim())) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(2000);

  const count = await page.evaluate(`(function(){var els=document.querySelectorAll("*");for(var i=0;i<els.length;i++){var t=(els[i].textContent||"").trim();var m=t.match(/^(\\d[\\d,]*)\\s*PROPERT/i);if(m){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0)return m[1]}}return "0"})()`);
  console.log(`Results: ${count}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-results.png") });

  // Step 1: Click Actions dropdown
  console.log("\nStep 1: Click Actions...");
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-actions-dropdown.png") });

  // Step 2: Click "Input Range"
  console.log("Step 2: Click Input Range...");
  const irClicked = await page.evaluate(`(function(){
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li, [role='menuitem']");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      if (/input range/i.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { els[i].click(); return ownText.trim(); }
      }
    }
    return null;
  })()`);
  console.log(`  Clicked: ${irClicked}`);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-after-input-range.png") });

  // Step 3: Find what appeared — look for new input fields
  const newInputs = await page.evaluate(`(function(){
    var inputs = document.querySelectorAll("input");
    var results = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 20 && r.height > 10 && r.y > 40 && r.y < 300) {
        results.push({
          type: inputs[i].type,
          placeholder: inputs[i].placeholder,
          value: inputs[i].value,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          className: (inputs[i].className || "").slice(0, 50)
        });
      }
    }
    return results;
  })()`);
  console.log("Visible inputs:", JSON.stringify(newInputs, null, 2));

  // Step 4: Also check for any new buttons or UI elements that appeared
  const rangeUI = await page.evaluate(`(function(){
    var items = [];
    var els = document.querySelectorAll("button, input, span, div");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 20 && r.height > 10 && r.y > 40 && r.y < 200 && r.x > 800) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) {
          if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
        }
        var t = ownText.trim();
        if (t.length > 0 && t.length < 50) {
          items.push({
            tag: els[i].tagName,
            text: t,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height)
          });
        }
      }
    }
    return items;
  })()`);
  console.log("Right side UI:", JSON.stringify(rangeUI, null, 2));

  // Step 5: Try filling the range inputs
  const maxRange = Number(String(count).replace(/,/g, "")) || 224;
  console.log(`\nStep 5: Setting range 1-${maxRange}...`);

  // Find inputs that look like range inputs (small number inputs near top-right)
  const rangeFill = await page.evaluate(`(function(){
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    var inputs = document.querySelectorAll("input[type='number'], input[type='text'], input:not([type])");
    var rangeInputs = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      // Look for small number inputs in the right panel header area
      if (r.width > 20 && r.width < 100 && r.height > 10 && r.y > 40 && r.y < 200 && r.x > 800) {
        rangeInputs.push({ el: inputs[i], x: r.x, y: r.y, w: r.width, ph: inputs[i].placeholder, val: inputs[i].value });
      }
    }
    rangeInputs.sort(function(a,b){ return a.x - b.x; });
    if (rangeInputs.length >= 2) {
      ns.call(rangeInputs[0].el, "1");
      rangeInputs[0].el.dispatchEvent(new Event("input", { bubbles: true }));
      rangeInputs[0].el.dispatchEvent(new Event("change", { bubbles: true }));
      ns.call(rangeInputs[1].el, "${maxRange}");
      rangeInputs[1].el.dispatchEvent(new Event("input", { bubbles: true }));
      rangeInputs[1].el.dispatchEvent(new Event("change", { bubbles: true }));
      return { filled: true, count: rangeInputs.length, input1: { x: rangeInputs[0].x, ph: rangeInputs[0].ph }, input2: { x: rangeInputs[1].x, ph: rangeInputs[1].ph } };
    }
    return { filled: false, count: rangeInputs.length, all: rangeInputs.map(function(r){ return { x: r.x, y: r.y, w: r.w, ph: r.ph, val: r.val }; }) };
  })()`);
  console.log("Range fill:", JSON.stringify(rangeFill, null, 2));

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "04-range-filled.png") });

  // Step 6: Click "Show Property Range" or submit button
  const showRange = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, span, div, a");
    var results = [];
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      var r = btns[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y > 40 && r.y < 200 && r.x > 800) {
        if (/show|apply|go|submit|range/i.test(t) && t.length < 40) {
          results.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), tag: btns[i].tagName });
        }
      }
    }
    return results;
  })()`);
  console.log("Range buttons:", JSON.stringify(showRange));

  // Click the show/apply button
  if (showRange.length > 0) {
    const btn = showRange[0];
    const clicked = await page.evaluate(`(function(){
      var btns = document.querySelectorAll("button, span, div, a");
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        var r = btns[i].getBoundingClientRect();
        if (t === ${JSON.stringify(btn.text)} && Math.abs(r.x - ${btn.x}) < 5 && Math.abs(r.y - ${btn.y}) < 5) {
          btns[i].click();
          return true;
        }
      }
      return false;
    })()`);
    console.log(`Clicked "${btn.text}": ${clicked}`);
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "05-after-show-range.png") });

  // Check how many checkboxes are now selected
  const selectedCount = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var n = 0;
    for (var i = 0; i < cbs.length; i++) {
      if (cbs[i].checked) n++;
    }
    return n;
  })()`);
  console.log(`Selected: ${selectedCount}`);

  // Check the "50 SELECTED" badge
  const selectedBadge = await page.evaluate(`(function(){
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/\\d+\\s*SELECTED/i.test(t)) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y < 200) return t.slice(0, 30);
      }
    }
    return null;
  })()`);
  console.log(`Badge: ${selectedBadge}`);

  await browser.close();
})();
