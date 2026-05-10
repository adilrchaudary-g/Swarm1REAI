import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-v4");

function toggleFilterJS(name: string) {
  return `(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()===${JSON.stringify(name)}){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`;
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
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Get the total result count
  const totalCount = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      var m = ownText.trim().match(/^(\\d+)\\s*PROPERT/i);
      if (m) return parseInt(m[1]);
    }
    return 0;
  })()`);
  console.log(`Total properties: ${totalCount}`);

  // Count current checkboxes before Input Range
  const beforeCount = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var total = 0, checked = 0;
    for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
    return { total, checked };
  })()`);
  console.log(`Before: ${beforeCount.checked}/${beforeCount.total} checked`);

  // Open Actions → Input Range
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Get range input coordinates
  const inputs = await page.evaluate(`(function(){
    var results = [];
    var inputs = document.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var cls = (inputs[i].className || "").toLowerCase();
      if (!/inputbox/i.test(cls)) continue;
      var r = inputs[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      results.push({
        x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
        w: Math.round(r.width), h: Math.round(r.height),
        left: /left/i.test(cls), val: inputs[i].value, ph: inputs[i].placeholder
      });
    }
    return results;
  })()`);
  console.log(`Found ${inputs.length} range inputs:`);
  for (const inp of inputs) console.log(`  ${inp.left ? "LEFT" : "RIGHT"}: (${inp.x},${inp.y}) val="${inp.val}" ph="${inp.ph}"`);

  const maxVal = String(totalCount || 224);

  // TEST A: Try different approaches to fill the inputs
  console.log(`\n--- Test A: Playwright fill via locator ---`);
  const leftLoc = page.locator('[class*="inputBoxLeft"]').first();
  const rightLoc = page.locator('[class*="inputBoxRight"]').first();

  if (await leftLoc.isVisible().catch(() => false)) {
    await leftLoc.click();
    await page.waitForTimeout(100);
    await leftLoc.fill("1");
    await page.waitForTimeout(300);
    console.log(`  Left value: ${await leftLoc.inputValue()}`);

    await rightLoc.click();
    await page.waitForTimeout(100);
    await rightLoc.fill(maxVal);
    await page.waitForTimeout(300);
    console.log(`  Right value: ${await rightLoc.inputValue()}`);
  }

  // Check React state by examining internal fiber
  const reactState = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    if (!left || !right) return null;
    // Check React fiber for state
    var fiberKey = Object.keys(left).find(function(k){ return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"); });
    var propsKey = Object.keys(left).find(function(k){ return k.startsWith("__reactProps"); });
    return {
      leftValue: left.value,
      rightValue: right.value,
      fiberKey: fiberKey || "none",
      propsKey: propsKey || "none",
      leftOnChange: propsKey ? typeof left[propsKey]?.onChange : "none",
      rightOnChange: propsKey ? typeof right[propsKey]?.onChange : "none"
    };
  })()`);
  console.log(`React state: ${JSON.stringify(reactState)}`);

  // TEST B: Trigger React's onChange directly via React fiber
  console.log(`\n--- Test B: Direct React onChange call ---`);
  const onChangeResult = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    if (!left || !right) return "inputs not found";

    var propsKey = Object.keys(left).find(function(k){ return k.startsWith("__reactProps"); });
    if (!propsKey) return "no react props key";

    var leftProps = left[propsKey];
    var rightProps = right[propsKey];

    if (!leftProps?.onChange || !rightProps?.onChange) return "no onChange handlers";

    // Simulate React onChange events
    leftProps.onChange({ target: { value: "1" } });
    rightProps.onChange({ target: { value: "${maxVal}" } });

    return { leftVal: left.value, rightVal: right.value, method: "react-onChange" };
  })()`);
  console.log(`React onChange result: ${JSON.stringify(onChangeResult)}`);
  await page.waitForTimeout(500);

  // Read back values
  const valuesAfterReact = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    return { left: left?.value, right: right?.value };
  })()`);
  console.log(`Values after React onChange: ${JSON.stringify(valuesAfterReact)}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-after-react-onchange.png") });

  // Click Show Property Range
  const showBtnCoords = await page.evaluate(`(function(){
    var els = document.querySelectorAll("button, span, div, a");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/show property range/i.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      }
    }
    return null;
  })()`);

  if (showBtnCoords) {
    await page.mouse.click(showBtnCoords.x, showBtnCoords.y);
    console.log(`Clicked Show Property Range at (${showBtnCoords.x}, ${showBtnCoords.y})`);
    await page.waitForTimeout(5000);

    const afterShow = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var total = 0, checked = 0;
      for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
      var badges = [];
      var els = document.querySelectorAll("span, div, p");
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || "").trim();
        if (/selected/i.test(t) && t.length < 30) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 200) badges.push(t); }
      }
      return { total, checked, badges };
    })()`);
    console.log(`After Show Property Range: ${afterShow.checked}/${afterShow.total} checked, badges: ${JSON.stringify(afterShow.badges)}`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "02-after-show.png") });
  }

  // TEST C: Try with a smaller range — just 1 to 5
  console.log(`\n--- Test C: Small range 1-5 via React onChange ---`);
  await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    var propsKey = Object.keys(left).find(function(k){ return k.startsWith("__reactProps"); });
    if (propsKey && left[propsKey]?.onChange) {
      left[propsKey].onChange({ target: { value: "1" } });
      right[propsKey].onChange({ target: { value: "5" } });
    }
  })()`);
  await page.waitForTimeout(500);

  const smallRangeVals = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    return { left: left?.value, right: right?.value };
  })()`);
  console.log(`Small range values: ${JSON.stringify(smallRangeVals)}`);

  if (showBtnCoords) {
    await page.mouse.click(showBtnCoords.x, showBtnCoords.y);
    console.log("Clicked Show Property Range (small range)");
    await page.waitForTimeout(5000);

    const afterSmall = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var total = 0, checked = 0;
      for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
      return { total, checked };
    })()`);
    console.log(`After small range: ${afterSmall.checked}/${afterSmall.total} checked`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-small-range.png") });
  }

  // TEST D: Walk up React component tree to find the state handler
  console.log(`\n--- Test D: Walk React fiber tree ---`);
  const fiberInfo = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    if (!left) return "no left input";
    var fiberKey = Object.keys(left).find(function(k){ return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"); });
    if (!fiberKey) return "no fiber key";
    var fiber = left[fiberKey];
    // Walk up the fiber tree to find state with the range values
    var info = [];
    var node = fiber;
    for (var depth = 0; depth < 20 && node; depth++) {
      var stateNode = node.memoizedState;
      var stateKeys = [];
      var s = stateNode;
      for (var si = 0; si < 5 && s; si++) {
        if (s.memoizedState !== undefined && s.memoizedState !== null) {
          var val = s.memoizedState;
          if (typeof val === "object" && val !== null) {
            stateKeys.push(JSON.stringify(val).substring(0, 100));
          } else {
            stateKeys.push(String(val));
          }
        }
        s = s.next;
      }
      if (stateKeys.length > 0) {
        info.push({ depth: depth, type: (node.type?.name || node.type || "").toString().substring(0, 30), state: stateKeys });
      }
      node = node.return;
    }
    return info;
  })()`);
  console.log(JSON.stringify(fiberInfo, null, 2));

  await browser.close();
  console.log("\nDone.");
})();
