import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "range-network");

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
  console.log("Filters applied.");

  // Open Actions → Input Range
  await page.evaluate(`(function(){ var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn']"); for (var i = 0; i < btns.length; i++) { var ownText = ""; for (var j = 0; j < btns[i].childNodes.length; j++) { if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent; } if (ownText.trim() === "Actions") { var r = btns[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) { btns[i].click(); return; } } } })()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(function(){ var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, li"); for (var i = 0; i < els.length; i++) { var ownText = ""; for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; } if (/input range/i.test(ownText.trim())) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { els[i].click(); return; } } } })()`);
  await page.waitForTimeout(2000);

  // Fill using Playwright .fill() on the locators
  const leftInput = page.locator('[class*="inputBoxLeft"]').first();
  const rightInput = page.locator('[class*="inputBoxRight"]').first();

  console.log(`Left visible: ${await leftInput.isVisible().catch(() => false)}`);
  console.log(`Right visible: ${await rightInput.isVisible().catch(() => false)}`);

  // Fill values using .fill()
  await leftInput.click();
  await leftInput.fill("1");
  await page.waitForTimeout(300);
  await rightInput.click();
  await rightInput.fill("224");
  await page.waitForTimeout(500);

  console.log(`Left value: ${await leftInput.inputValue()}`);
  console.log(`Right value: ${await rightInput.inputValue()}`);

  // Set up network interception BEFORE clicking
  const networkLog: { url: string; method: string; body: string }[] = [];
  page.on("request", (req: any) => {
    if (req.url().includes("propstream.com") && !req.url().includes(".js") && !req.url().includes(".css") && !req.url().includes(".png") && !req.url().includes(".svg")) {
      networkLog.push({
        url: req.url(),
        method: req.method(),
        body: (req.postData() || "").substring(0, 500),
      });
    }
  });

  const responseLog: { url: string; status: number; body: string }[] = [];
  page.on("response", async (res: any) => {
    if (res.url().includes("propstream.com") && !res.url().includes(".js") && !res.url().includes(".css") && res.status() < 400) {
      try {
        const body = await res.text().catch(() => "");
        if (body.length > 10 && body.length < 5000) {
          responseLog.push({ url: res.url(), status: res.status(), body: body.substring(0, 500) });
        }
      } catch {}
    }
  });

  // Click "Show Property Range" using Playwright locator
  console.log("\nClicking Show Property Range...");
  const showBtn = page.locator("button").filter({ hasText: /Show Property Range/i }).first();
  const showBtnAlt = page.getByText("Show Property Range").first();

  if (await showBtn.isVisible().catch(() => false)) {
    console.log("Found via button filter");
    await showBtn.click();
  } else if (await showBtnAlt.isVisible().catch(() => false)) {
    console.log("Found via getByText");
    await showBtnAlt.click();
  } else {
    console.log("Button not found via locator, trying coordinate click");
    const coords = await page.evaluate(`(function(){
      var els = document.querySelectorAll("*");
      for (var i = 0; i < els.length; i++) {
        var ownText = "";
        for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
        if (/show property range/i.test(ownText.trim())) {
          var r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), tag: els[i].tagName };
        }
      }
      return null;
    })()`);
    console.log(`Coords: ${JSON.stringify(coords)}`);
    if (coords) await page.mouse.click(coords.x, coords.y);
  }
  await page.waitForTimeout(5000);

  console.log(`\nNetwork requests: ${networkLog.length}`);
  for (const req of networkLog) {
    console.log(`  ${req.method} ${req.url.substring(0, 100)}`);
    if (req.body) console.log(`    Body: ${req.body}`);
  }
  console.log(`\nResponses: ${responseLog.length}`);
  for (const res of responseLog) {
    console.log(`  ${res.status} ${res.url.substring(0, 100)}`);
    console.log(`    Body: ${res.body.substring(0, 200)}`);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-after-show.png") });

  // Check the React component state more deeply
  console.log("\nReact component internals:");
  const componentState = await page.evaluate(`(function(){
    // Find the Show Property Range button's React fiber
    var els = document.querySelectorAll("*");
    var showBtn = null;
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) { if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent; }
      if (/show property range/i.test(ownText.trim())) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { showBtn = els[i]; break; }
      }
    }
    if (!showBtn) return "show button not found";

    // Get the React fiber
    var fiberKey = Object.keys(showBtn).find(function(k){ return k.startsWith("__reactFiber"); });
    if (!fiberKey) return "no fiber";

    // Walk up to find the parent component with state
    var fiber = showBtn[fiberKey];
    var results = [];
    var node = fiber;
    for (var depth = 0; depth < 30 && node; depth++) {
      // Look for onClick handler
      var propsKey = Object.keys(node.stateNode || {}).find(function(k){ return k.startsWith("__reactProps"); });
      var props = node.memoizedProps || {};
      if (props.onClick) {
        results.push({
          depth: depth,
          type: (node.type?.name || node.type || "").toString().substring(0, 30),
          hasOnClick: true,
          onClickStr: props.onClick.toString().substring(0, 200)
        });
      }
      node = node.return;
    }
    return results;
  })()`);
  console.log(JSON.stringify(componentState, null, 2));

  // Try: Close Input Range, then directly select all 224 using React internal APIs
  console.log("\n--- Trying direct React store dispatch ---");

  // Find the Redux/Context store
  const storeInfo = await page.evaluate(`(function(){
    // Check for Redux store
    if (window.__REDUX_STORE__) return { type: "redux", state: JSON.stringify(window.__REDUX_STORE__.getState()).substring(0, 500) };
    if (window.store) return { type: "window.store", keys: Object.keys(window.store).slice(0, 20) };

    // Check for React root
    var root = document.getElementById("root") || document.getElementById("app");
    if (!root) return "no root element";

    var fiberKey = Object.keys(root).find(function(k){ return k.startsWith("__reactContainer") || k.startsWith("__reactFiber"); });
    if (!fiberKey) return "no fiber on root";

    // Walk the fiber tree looking for context with selected properties
    var fiber = root[fiberKey];
    var contexts = [];
    var visited = new Set();
    var queue = [fiber];
    var checked = 0;
    while (queue.length > 0 && checked < 100) {
      var node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      checked++;

      // Check memoizedState for anything that looks like selected properties
      var state = node.memoizedState;
      var s = state;
      for (var si = 0; si < 10 && s; si++) {
        var val = s.memoizedState;
        if (val && typeof val === "object") {
          var str = "";
          try { str = JSON.stringify(val).substring(0, 200); } catch(e) {}
          if (/select|check|range|input/i.test(str) && str.length > 20) {
            contexts.push({
              depth: checked,
              type: (node.type?.name || node.type || "?").toString().substring(0, 30),
              state: str
            });
          }
        }
        s = s.next;
      }

      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
    }
    return { type: "fiber-walk", contexts: contexts.slice(0, 10) };
  })()`);
  console.log(JSON.stringify(storeInfo, null, 2));

  await browser.close();
  console.log("\nDone.");
})();
