import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "adilrchaudary@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "pagination-test");

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

  // Search with Vacant + Pre-Probate
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
  // Close filters
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, span, a"); for (var i = 0; i < btns.length; i++) { var t = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) t += btns[i].childNodes[j].textContent; } if (/^filters$/i.test(t.trim())) { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y < 80) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  console.log("Search results loaded. Examining pagination...");

  // Step 1: Capture the first address on page 1
  const page1Addr = await page.evaluate(`(function(){
    var cells = document.querySelectorAll('.ag-cell[col-id="address"], [col-id="formattedAddress"]');
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return (cells[i].textContent || "").trim();
    }
    var rows = document.querySelectorAll('[id^="property-"]');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return (rows[i].textContent || "").trim().substring(0, 80);
    }
    return "unknown";
  })()`);
  console.log(`Page 1 first result: ${page1Addr}`);

  // Step 2: Inspect all paginator elements
  const paginatorInfo = await page.evaluate(`(function(){
    var results = { inputs: [], buttons: [], divs: [] };

    // Find inputs near the bottom
    var inputs = document.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.y > 600) {
        results.inputs.push({
          y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
          type: inputs[i].type, placeholder: inputs[i].placeholder, value: inputs[i].value,
          classes: inputs[i].className.substring(0, 80),
          parentClasses: (inputs[i].parentElement?.className || "").substring(0, 80)
        });
      }
    }

    // Find navigation buttons (arrows, Next, Prev, page numbers)
    var btns = document.querySelectorAll("button, a, span, div");
    for (var i = 0; i < btns.length; i++) {
      var r = btns[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.y < 700) continue;
      var t = (btns[i].textContent || "").trim();
      if (t.length > 30) continue;
      if (/\\d|next|prev|>|<|›|‹|»|«|arrow|page/i.test(t) || btns[i].querySelector("svg, img, [class*='arrow'], [class*='chevron']")) {
        results.buttons.push({
          tag: btns[i].tagName, y: Math.round(r.y), x: Math.round(r.x),
          w: Math.round(r.width), h: Math.round(r.height),
          text: t, classes: (btns[i].className || "").substring(0, 80)
        });
      }
    }

    // Find anything with "paginator" class
    var all = document.querySelectorAll("[class*='aginator'], [class*='pager'], [class*='Pager']");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      results.divs.push({
        tag: all[i].tagName, y: Math.round(r.y), x: Math.round(r.x),
        w: Math.round(r.width), h: Math.round(r.height),
        classes: (all[i].className || "").substring(0, 120),
        text: (all[i].textContent || "").trim().substring(0, 50)
      });
    }

    return results;
  })()`);
  console.log("\nPaginator elements:");
  console.log(JSON.stringify(paginatorInfo, null, 2));

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-page1.png") });

  // Step 3: Try clicking the next page arrow/button
  // First, look for a right arrow or "next" button near the paginator
  console.log("\nAttempting navigation methods...");

  // Method 1: Click the right/next arrow
  const nextClicked = await page.evaluate(`(function(){
    // Look for SVG arrows, ">", "›", or right-pointing elements near bottom of page
    var candidates = document.querySelectorAll("button, a, span, div, svg");
    for (var i = 0; i < candidates.length; i++) {
      var r = candidates[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.y < 700) continue;
      var t = (candidates[i].textContent || "").trim();
      var cls = (candidates[i].className || "").toString();
      // Check for right arrow indicators
      if (/right|next|forward|›|»/i.test(t) || /right|next|forward/i.test(cls)) {
        candidates[i].click();
        return { method: "text/class", text: t, classes: cls.substring(0, 50), x: Math.round(r.x), y: Math.round(r.y) };
      }
    }

    // Look for SVG path or polygon elements (arrow icons)
    var svgs = document.querySelectorAll("svg");
    for (var i = 0; i < svgs.length; i++) {
      var r = svgs[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.y < 700) continue;
      var parent = svgs[i].parentElement;
      if (parent) {
        var pr = parent.getBoundingClientRect();
        // Right-side arrow (higher x value in paginator area)
        if (pr.x > 700) {
          parent.click();
          return { method: "svg-parent-right", x: Math.round(pr.x), y: Math.round(pr.y) };
        }
      }
    }

    return null;
  })()`);
  console.log(`Method 1 (next arrow): ${JSON.stringify(nextClicked)}`);
  await page.waitForTimeout(3000);

  const page2Addr = await page.evaluate(`(function(){
    var cells = document.querySelectorAll('.ag-cell[col-id="address"], [col-id="formattedAddress"]');
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return (cells[i].textContent || "").trim();
    }
    var rows = document.querySelectorAll('[id^="property-"]');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return (rows[i].textContent || "").trim().substring(0, 80);
    }
    return "unknown";
  })()`);
  console.log(`After method 1, first result: ${page2Addr}`);
  console.log(`Changed: ${page2Addr !== page1Addr}`);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-after-method1.png") });

  // Method 2: If paginator has an input, use Playwright mouse click + keyboard type
  if (page2Addr === page1Addr) {
    console.log("\nMethod 2: Playwright click + type on paginator input...");
    // Find paginator input via evaluate, get coordinates, then use Playwright
    const inputCoords = await page.evaluate(`(function(){
      var inputs = document.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) {
        var r = inputs[i].getBoundingClientRect();
        if (r.width > 20 && r.width < 100 && r.height > 15 && r.y > 700) {
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), val: inputs[i].value };
        }
      }
      return null;
    })()`);
    console.log(`Input coords: ${JSON.stringify(inputCoords)}`);

    if (inputCoords) {
      // Triple-click to select all, then type new page number, then Enter
      await page.mouse.click(inputCoords.x, inputCoords.y, { clickCount: 3 });
      await page.waitForTimeout(200);
      await page.keyboard.type("2", { delay: 50 });
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);

      const page2bAddr = await page.evaluate(`(function(){
        var cells = document.querySelectorAll('.ag-cell[col-id="address"], [col-id="formattedAddress"]');
        for (var i = 0; i < cells.length; i++) {
          var r = cells[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return (cells[i].textContent || "").trim();
        }
        var rows = document.querySelectorAll('[id^="property-"]');
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return (rows[i].textContent || "").trim().substring(0, 80);
        }
        return "unknown";
      })()`);
      console.log(`After method 2, first result: ${page2bAddr}`);
      console.log(`Changed: ${page2bAddr !== page1Addr}`);

      await page.screenshot({ path: path.join(OUTPUT_DIR, "03-after-method2.png") });
    }
  }

  // Method 3: Find and list ALL clickable elements in the paginator area
  console.log("\nAll clickable elements y>700:");
  const bottomEls = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.y < 700 || r.y > 900) continue;
      if (r.height > 100) continue; // Skip large containers
      var tag = all[i].tagName;
      if (!/^(BUTTON|A|INPUT|SVG|SPAN|DIV|LI|IMG|I|PATH)$/i.test(tag)) continue;
      var t = "";
      for (var j = 0; j < all[i].childNodes.length; j++) {
        if (all[i].childNodes[j].nodeType === 3) t += all[i].childNodes[j].textContent;
      }
      t = t.trim();
      if (!t && tag !== "SVG" && tag !== "INPUT" && tag !== "IMG" && tag !== "I" && tag !== "PATH") continue;
      results.push({
        tag: tag, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        text: t.substring(0, 40), cls: (all[i].className || "").toString().substring(0, 60)
      });
    }
    return results;
  })()`);
  for (const el of bottomEls) {
    console.log(`  ${el.tag} (${el.x},${el.y}) ${el.w}x${el.h} "${el.text}" cls="${el.cls}"`);
  }

  // Method 4: Look for AG-Grid paginator specifically
  console.log("\nAG-Grid paginator elements:");
  const agPager = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll('[class*="ag-paging"], [ref*="Page"], [ref*="paging"]');
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      results.push({
        tag: all[i].tagName, x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        ref: all[i].getAttribute("ref") || "",
        cls: (all[i].className || "").toString().substring(0, 100),
        text: (all[i].textContent || "").trim().substring(0, 50)
      });
    }
    return results;
  })()`);
  for (const el of agPager) {
    console.log(`  ${el.tag} ref="${el.ref}" "${el.text}" cls="${el.cls}"`);
  }

  // Method 5: Scroll the property list cards to find a "load more" or pagination below cards
  console.log("\nChecking for card-based pagination / scroll loading...");
  const rightPanelScroll = await page.evaluate(`(function(){
    // Find the right panel with property cards
    var panels = document.querySelectorAll('[class*="rightPanel"], [class*="propertyList"], [class*="resultList"], [class*="SearchResultCard"]');
    var info = [];
    for (var i = 0; i < panels.length; i++) {
      var r = panels[i].getBoundingClientRect();
      if (r.width > 200) {
        info.push({
          cls: (panels[i].className || "").substring(0, 80),
          scrollH: panels[i].scrollHeight, clientH: panels[i].clientHeight,
          scrollTop: panels[i].scrollTop, y: Math.round(r.y), h: Math.round(r.height)
        });
      }
    }
    return info;
  })()`);
  console.log(JSON.stringify(rightPanelScroll, null, 2));

  await browser.close();
  console.log("\nDone.");
})();
