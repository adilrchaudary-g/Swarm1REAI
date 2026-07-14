import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-v5");

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

  const totalCount = await page.evaluate(`(function(){
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      var m = ownText.trim().match(/^(\\d+)\\s*PROPERT/i);
      if (m) return parseInt(m[1]);
    }
    return 224;
  })()`);
  console.log(`Total: ${totalCount || 224}`);

  // Open Actions → Input Range
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Approach: Use React onChange with a proper synthetic event
  const maxVal = String(totalCount || 224);
  console.log(`\n--- Setting range 1 to ${maxVal} via React onChange with full event ---`);

  const setResult = await page.evaluate(`(function(){
    var left = document.querySelector('[class*="inputBoxLeft"]');
    var right = document.querySelector('[class*="inputBoxRight"]');
    if (!left || !right) return "inputs not found";

    var propsKey = Object.keys(left).find(function(k){ return k.startsWith("__reactProps"); });
    if (!propsKey) return "no react props";

    function makeEvent(input, value) {
      var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      ns.call(input, value);
      var evt = new Event("input", { bubbles: true });
      input.dispatchEvent(evt);
      input.dispatchEvent(new Event("change", { bubbles: true }));

      // Also call React's onChange with a proper event-like object
      var reactProps = input[propsKey];
      if (reactProps && reactProps.onChange) {
        try {
          reactProps.onChange({
            target: input,
            currentTarget: input,
            preventDefault: function(){},
            stopPropagation: function(){},
            nativeEvent: evt,
            type: "change"
          });
        } catch(e) {
          return "onChange error: " + e.message;
        }
      }
      return input.value;
    }

    var leftResult = makeEvent(left, "1");
    var rightResult = makeEvent(right, "${maxVal}");
    return { left: leftResult, right: rightResult };
  })()`);
  console.log(`Set result: ${JSON.stringify(setResult)}`);
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-after-set.png") });

  // Click Show Property Range
  const showBtn = await page.evaluate(`(function(){
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

  if (showBtn) {
    await page.mouse.click(showBtn.x, showBtn.y);
    console.log("Clicked Show Property Range");
    await page.waitForTimeout(5000);
  }

  const afterShow1 = await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    var total = 0, checked = 0;
    for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
    return { total, checked };
  })()`);
  console.log(`After React onChange: ${afterShow1.checked}/${afterShow1.total} checked`);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-after-show-react.png") });

  // Approach 2: Use Playwright Locator .fill() + Tab + Enter on "Show Property Range"
  console.log(`\n--- Approach 2: Locator fill + Tab ---`);

  // Re-open Input Range if it closed
  const isRangeOpen = await page.evaluate(`(function(){
    return !!document.querySelector('[class*="inputBoxLeft"]');
  })()`);
  if (!isRangeOpen) {
    await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
    await page.waitForTimeout(800);
    await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
    await page.waitForTimeout(2000);
  }

  // Get coordinates and use mouse + keyboard
  const leftCoords = await page.evaluate(`(function(){
    var inp = document.querySelector('[class*="inputBoxLeft"]');
    if (!inp) return null;
    var r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
  const rightCoords = await page.evaluate(`(function(){
    var inp = document.querySelector('[class*="inputBoxRight"]');
    if (!inp) return null;
    var r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);

  if (leftCoords && rightCoords) {
    // Click left, select all, type value
    await page.mouse.click(leftCoords.x, leftCoords.y);
    await page.waitForTimeout(200);
    await page.keyboard.press("Meta+a"); // Select all on Mac
    await page.waitForTimeout(100);
    await page.keyboard.type("1", { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.press("Tab"); // Tab to right input
    await page.waitForTimeout(200);
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(100);
    await page.keyboard.type(maxVal, { delay: 30 });
    await page.waitForTimeout(500);

    // Verify values
    const vals = await page.evaluate(`(function(){
      var l = document.querySelector('[class*="inputBoxLeft"]');
      var r = document.querySelector('[class*="inputBoxRight"]');
      return { left: l?.value, right: r?.value };
    })()`);
    console.log(`Values: ${JSON.stringify(vals)}`);

    // Press Enter to submit
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);

    const afterEnter = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var total = 0, checked = 0;
      for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
      return { total, checked };
    })()`);
    console.log(`After Enter: ${afterEnter.checked}/${afterEnter.total} checked`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-after-enter.png") });

    // Click Show Property Range button explicitly
    if (showBtn) {
      await page.mouse.click(showBtn.x, showBtn.y);
      await page.waitForTimeout(5000);
    }

    const afterShow2 = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var total = 0, checked = 0;
      for (var i = 0; i < cbs.length; i++) { total++; if (cbs[i].checked) checked++; }
      return { total, checked };
    })()`);
    console.log(`After Show: ${afterShow2.checked}/${afterShow2.total} checked`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "04-after-show-tab.png") });
  }

  // Approach 3: Completely different — skip Input Range, use scroll + check batches
  console.log(`\n--- Approach 3: Manual scroll + checkbox click ---`);

  // First uncheck any checked boxes
  await page.evaluate(`(function(){
    var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
    for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) cbs[i].click(); }
  })()`);
  await page.waitForTimeout(500);

  // Find the scrollable container
  const scrollContainer = await page.evaluate(`(function(){
    var divs = document.querySelectorAll("div");
    for (var i = 0; i < divs.length; i++) {
      var cls = (divs[i].className || "");
      if (/view/i.test(cls) && divs[i].scrollHeight > divs[i].clientHeight + 100) {
        var r = divs[i].getBoundingClientRect();
        if (r.x > 800 && r.width > 300 && r.height > 400) {
          return {
            cls: cls.substring(0, 60),
            scrollH: divs[i].scrollHeight, clientH: divs[i].clientHeight,
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
          };
        }
      }
    }
    return null;
  })()`);
  console.log(`Scroll container: ${JSON.stringify(scrollContainer)}`);

  // Scroll and check all visible checkboxes
  let totalChecked = 0;
  const seenIds = new Set<string>();

  for (let scroll = 0; scroll < 30; scroll++) {
    const checked = await page.evaluate(`(function(){
      var cbs = document.querySelectorAll("[id^='property-'] input[type='checkbox']");
      var n = 0;
      for (var i = 0; i < cbs.length; i++) {
        var r = cbs[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !cbs[i].checked) {
          cbs[i].click();
          n++;
        }
      }
      return n;
    })()`);
    totalChecked += checked;

    // Get current property IDs to detect when we've scrolled past all
    const ids = await page.evaluate(`(function(){
      var ids = [];
      var cbs = document.querySelectorAll("[id^='property-']");
      for (var i = 0; i < cbs.length; i++) {
        var r = cbs[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) ids.push(cbs[i].id);
      }
      return ids;
    })()`);

    const newIds = ids.filter((id: string) => !seenIds.has(id));
    ids.forEach((id: string) => seenIds.add(id));

    if (scroll % 5 === 0) {
      console.log(`  Scroll ${scroll}: checked ${checked} new, ${totalChecked} total, ${newIds.length} new IDs, ${seenIds.size} unique`);
    }

    if (newIds.length === 0 && scroll > 2) {
      console.log(`  No new properties found — reached end at scroll ${scroll}`);
      break;
    }

    // Scroll the container down
    await page.evaluate(`(function(){
      var divs = document.querySelectorAll("div");
      for (var i = 0; i < divs.length; i++) {
        var cls = (divs[i].className || "");
        if (/view/i.test(cls) && divs[i].scrollHeight > divs[i].clientHeight + 100) {
          var r = divs[i].getBoundingClientRect();
          if (r.x > 800 && r.width > 300 && r.height > 400) {
            divs[i].scrollTop += 500;
            return;
          }
        }
      }
    })()`);
    await page.waitForTimeout(800);
  }

  console.log(`\nTotal unique properties seen: ${seenIds.size}`);
  console.log(`Total checkboxes clicked: ${totalChecked}`);

  // Check final selected count
  const badges = await page.evaluate(`(function(){
    var results = [];
    var els = document.querySelectorAll("span, div, p");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/selected/i.test(t) && t.length < 30) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 200) results.push(t); }
    }
    return results;
  })()`);
  console.log(`Selected badges: ${JSON.stringify(badges)}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "05-after-scroll-check.png") });

  await browser.close();
  console.log("\nDone.");
})();
