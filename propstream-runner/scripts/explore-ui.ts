import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output", "explore");

async function dismissAll(page: any) {
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"], [class*="ModalOverlay"]').forEach(function(el){ el.remove(); });
    document.querySelectorAll('[class*="modalWrapper"], [class*="ModalWrapper"]').forEach(function(el){ el.remove(); });
    document.body.classList.remove("bodyModal");
    document.body.style.overflow = "";
  })()`);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(`(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){if(/^close$/i.test((btns[i].textContent||"").trim()))btns[i].click()}})()`);
    await page.waitForTimeout(300);
  }
}

async function dumpElements(page: any, label: string, minX: number, maxX: number, minY: number, maxY: number) {
  const js = `(function(){
    var results = [];
    var els = document.querySelectorAll("button, a, input, select, [role='button'], [role='tab'], [class*='Toggle'], [class*='toggle'], [class*='dropdownToggle'], [class*='btn'], [class*='Btn']");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.x < ${minX} || r.x > ${maxX} || r.y < ${minY} || r.y > ${maxY}) continue;
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      results.push({
        tag: els[i].tagName,
        text: ownText.trim().slice(0, 60) || (els[i].textContent || "").trim().slice(0, 60),
        type: els[i].type || "",
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        disabled: els[i].disabled || false,
        placeholder: els[i].placeholder || "",
      });
    }
    return results;
  })()`;
  const elements = await page.evaluate(js);
  console.log("\n=== " + label + " ===");
  for (const el of elements as any[]) {
    const parts = [
      "<" + el.tag + ">",
      el.text ? '"' + el.text + '"' : "",
      el.placeholder ? 'ph="' + el.placeholder + '"' : "",
      el.type ? "type=" + el.type : "",
      "@(" + el.x + "," + el.y + ") " + el.w + "x" + el.h,
      el.disabled ? "DISABLED" : "",
    ].filter(Boolean).join(" ");
    console.log("  " + parts);
  }
  return elements;
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome",
    viewport: { width: 1400, height: 900 }, acceptDownloads: true,
  });
  const page = browser.pages()[0] || await browser.newPage();

  // === SEARCH RESULTS ===
  console.log("\n========== SEARCH RESULTS PAGE ==========");
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await dismissAll(page);

  const searchInput = page.locator('div[class*="searchInput"] input').first();
  await searchInput.click({ force: true });
  await searchInput.fill("Cuyahoga County, OH");
  await page.waitForTimeout(1000);
  const sug = page.locator('[class*="suggestion"], [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await sug.isVisible({ timeout: 3000 }).catch(() => false)) await sug.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Toggle Vacant + Pre-Foreclosures
  await page.getByText(/^filters$/i).first().click({ force: true }).catch(() => null);
  await page.waitForTimeout(1500);
  await page.evaluate(`(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()==="Vacant"){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`);
  await page.waitForTimeout(300);
  await page.evaluate(`(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()==="Pre-Foreclosures"){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`);
  await page.waitForTimeout(300);
  // Close filter panel
  await page.evaluate(`(function(){var btns=document.querySelectorAll("button,div,span,a");for(var i=0;i<btns.length;i++){var t="";for(var j=0;j<btns[i].childNodes.length;j++){if(btns[i].childNodes[j].nodeType===3)t+=btns[i].childNodes[j].textContent}if(/^filters$/i.test(t.trim())){var r=btns[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.y<80){btns[i].click();return true}}}return false})()`);
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "01-search-results.png") });
  await dumpElements(page, "TOP TOOLBAR", 0, 1400, 0, 80);
  await dumpElements(page, "RIGHT PANEL HEADER", 900, 1400, 80, 200);

  // === INPUT RANGE ===
  console.log("\n========== INPUT RANGE ==========");
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("[class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") { btns[i].click(); return true; }
    }
    return false;
  })()`);
  await page.waitForTimeout(1000);

  await page.evaluate(`(function(){
    var els = document.querySelectorAll("[class*='dropdownItem']");
    for (var i = 0; i < els.length; i++) {
      if (/input range/i.test(els[i].textContent)) { els[i].click(); return true; }
    }
    return false;
  })()`);
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-input-range.png") });
  await dumpElements(page, "INPUT RANGE AREA", 900, 1400, 100, 400);

  const rangeInputs = await page.evaluate(`(function(){
    var inputs = document.querySelectorAll("input");
    var results = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.x > 900 && r.y > 100 && r.y < 400) {
        results.push({ placeholder: inputs[i].placeholder, value: inputs[i].value, type: inputs[i].type, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), cls: (inputs[i].className||"").slice(0,80) });
      }
    }
    return results;
  })()`);
  console.log("\nRange inputs:", JSON.stringify(rangeInputs, null, 2));

  // Fill 1-500
  const fillResult = await page.evaluate(`(function(){
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    var inputs = document.querySelectorAll("input");
    var filled = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.x > 900 && r.y > 100 && r.y < 400 && inputs[i].type !== "checkbox") {
        var val = filled.length === 0 ? "1" : "500";
        ns.call(inputs[i], val);
        inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
        inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
        filled.push({ val: val, placeholder: inputs[i].placeholder, x: Math.round(r.x) });
      }
    }
    return filled;
  })()`);
  console.log("Fill result:", JSON.stringify(fillResult));
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-range-filled.png") });

  // Find buttons near range
  const rangeButtons = await page.evaluate(`(function(){
    var results = [];
    var els = document.querySelectorAll("button, div[role='button'], [class*='btn'], [class*='Btn'], svg, [class*='icon']");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.x > 1200 && r.y > 130 && r.y < 300 && r.width < 100) {
        results.push({
          tag: els[i].tagName,
          text: (els[i].textContent || "").trim().slice(0, 40),
          cls: (els[i].className || "").toString().slice(0, 80),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        });
      }
    }
    return results;
  })()`);
  console.log("Range buttons:", JSON.stringify(rangeButtons, null, 2));

  // Now check: after filling range, is there a "Show Property Range" button or similar?
  const showPropertyRange = await page.evaluate(`(function(){
    var els = document.querySelectorAll("button, div, span, a");
    var results = [];
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/show|property range|apply range|go|select range/i.test(t) && t.length < 40) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 100) {
          results.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), tag: els[i].tagName });
        }
      }
    }
    return results;
  })()`);
  console.log("Show/Apply buttons:", JSON.stringify(showPropertyRange));

  // Also check the Actions dropdown state after Input Range is open
  // The Actions dropdown might now have different items
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("[class*='dropdownToggleBtn']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") { btns[i].click(); return true; }
    }
    return false;
  })()`);
  await page.waitForTimeout(800);

  const actionsAfterRange = await page.evaluate(`(function(){
    var items = [];
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdownCard'] > *");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var t = ownText.trim();
      var r = els[i].getBoundingClientRect();
      if (t.length > 1 && t.length < 60 && r.width > 0 && r.height > 0) {
        items.push(t + " @(" + Math.round(r.x) + "," + Math.round(r.y) + ")");
      }
    }
    return [...new Set(items)];
  })()`);
  console.log("Actions after range:", JSON.stringify(actionsAfterRange));

  await page.screenshot({ path: path.join(OUTPUT_DIR, "04-actions-after-range.png") });

  // === MY PROPERTIES ===
  console.log("\n========== MY PROPERTIES ==========");
  await page.goto("https://app.propstream.com/property/group", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  await dismissAll(page);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "05-my-properties.png") });
  await dumpElements(page, "MY PROPERTIES SIDEBAR", 0, 300, 0, 900);
  await dumpElements(page, "MY PROPERTIES TOOLBAR", 300, 1400, 0, 200);

  // Click into a marketing list
  const listClick = await page.evaluate(`(function(){
    var els = document.querySelectorAll("div, span, a, p, li");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (/harvest-pre_foreclosure-177772011/i.test(t) && t.length < 80) {
        var r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 40) {
          els[i].click();
          return { clicked: true, text: t.slice(0, 50) };
        }
      }
    }
    return { clicked: false };
  })()`);
  console.log("\nList clicked:", JSON.stringify(listClick));
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "06-list-detail.png") });

  // AG-Grid analysis
  console.log("\n========== AG-GRID ==========");
  const agInfo = await page.evaluate(`(function(){
    var headers = document.querySelectorAll(".ag-header-cell");
    var cols = [];
    for (var i = 0; i < headers.length; i++) {
      var r = headers[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        cols.push({ colId: headers[i].getAttribute("col-id"), text: (headers[i].textContent||"").trim().slice(0,30), x: Math.round(r.x), w: Math.round(r.width) });
      }
    }
    var rows = document.querySelectorAll(".ag-row").length;
    // Pagination
    var pagTexts = [];
    var pags = document.querySelectorAll("[class*='Paginator'], [class*='paging']");
    for (var i = 0; i < pags.length; i++) {
      var t = (pags[i].textContent || "").replace(/\\s+/g, " ").trim();
      if (t) pagTexts.push(t.slice(0, 100));
    }
    // Page info from footer
    var footers = document.querySelectorAll("span, div");
    for (var i = 0; i < footers.length; i++) {
      var t = (footers[i].textContent || "").trim();
      var r = footers[i].getBoundingClientRect();
      if (/PAGE\\s+\\d/i.test(t) && t.length < 50 && r.y > 800 && r.width > 0) {
        pagTexts.push(t);
      }
    }
    return { cols: cols, rows: rows, pagination: pagTexts };
  })()`);
  console.log("AG-Grid:", JSON.stringify(agInfo, null, 2));

  // List page toolbar
  await dumpElements(page, "LIST PAGE TOOLBAR", 300, 1400, 0, 200);

  // Open Actions and dump
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("[class*='dropdownToggleBtn'], button, div");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50 && r.y < 250) { btns[i].click(); return true; }
      }
    }
    return false;
  })()`);
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "07-list-actions.png") });

  const listDropdownItems = await page.evaluate(`(function(){
    var items = [];
    var els = document.querySelectorAll("[class*='dropdownItem'], [class*='dropdown'] div, [class*='dropdown'] li, [class*='dropdown'] a");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var t = ownText.trim();
      var r = els[i].getBoundingClientRect();
      if (t.length > 2 && t.length < 60 && r.width > 0 && r.height > 0) {
        items.push(t + " @(" + Math.round(r.x) + "," + Math.round(r.y) + ")");
      }
    }
    return [...new Set(items)];
  })()`);
  console.log("\nList Actions:", JSON.stringify(listDropdownItems));

  await browser.close();
  console.log("\n========== EXPLORATION COMPLETE ==========");
})();
