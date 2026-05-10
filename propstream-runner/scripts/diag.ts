import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const PROFILE_DIR = path.join(os.homedir(), ".propstream-runner", "chrome-profile");
const OUTPUT_DIR = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "distressed-harvest-output");

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: "chrome",
    viewport: { width: 1400, height: 900 }, acceptDownloads: true,
  });
  const page = browser.pages()[0] || await browser.newPage();
  
  // Should already be logged in from persistent profile
  await page.goto("https://app.propstream.com/search", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  // Dismiss alerts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(`(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){if(/^close$/i.test((btns[i].textContent||"").trim()))btns[i].click()}})()`);
    await page.waitForTimeout(500);
  }
  
  // Enter Cuyahoga County
  const input = page.locator('div[class*="searchInput"] input').first();
  await input.click();
  await input.fill("Cuyahoga County, OH");
  await page.waitForTimeout(1000);
  const sug = page.locator('[class*="suggestion"], [class*="dropdown"] li, [class*="option"]').filter({ hasText: /cuyahoga/i }).first();
  if (await sug.isVisible({ timeout: 3000 }).catch(() => false)) await sug.click();
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Toggle Vacant filter
  await page.getByText(/^filters$/i).first().click({ force: true }).catch(() => null);
  await page.waitForTimeout(1500);
  await page.evaluate(`(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()==="Vacant"){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`);
  await page.waitForTimeout(300);
  await page.evaluate(`(function(){var els=document.querySelectorAll("p,span,div");for(var i=0;i<els.length;i++){var t="";for(var j=0;j<els[i].childNodes.length;j++){if(els[i].childNodes[j].nodeType===3)t+=els[i].childNodes[j].textContent}if(t.trim()==="Pre-Foreclosures"){var r=els[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.x>400){els[i].click();return true}}}return false})()`);
  await page.waitForTimeout(300);

  // Close filter panel
  await page.evaluate(`(function(){var btns=document.querySelectorAll("button,div,span,a");for(var i=0;i<btns.length;i++){var t="";for(var j=0;j<btns[i].childNodes.length;j++){if(btns[i].childNodes[j].nodeType===3)t+=btns[i].childNodes[j].textContent}if(/^filters$/i.test(t.trim())){var r=btns[i].getBoundingClientRect();if(r.width>0&&r.height>0&&r.y<80){btns[i].click();return true}}}return false})()`);
  await page.waitForTimeout(3000);

  // Select checkboxes
  await page.evaluate(`(function(){var cbs=document.querySelectorAll("[id^='property-'] input[type='checkbox']");var n=0;for(var i=0;i<cbs.length&&i<10;i++){if(!cbs[i].checked)cbs[i].click();if(cbs[i].checked)n++}return n})()`);
  await page.waitForTimeout(500);

  // BEFORE clicking Actions, snapshot all elements
  console.log("=== BEFORE ACTIONS CLICK ===");
  
  // Click Actions
  const actionsPos = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn'], [class*='Actions']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) {
          return { x: r.x, y: r.y, w: r.width, h: r.height, tag: btns[i].tagName, cls: btns[i].className.slice(0,100) };
        }
      }
    }
    return null;
  })()`);
  console.log("Actions button:", JSON.stringify(actionsPos));

  // Click it
  await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button, div, [class*='dropdownToggleBtn'], [class*='Actions']");
    for (var i = 0; i < btns.length; i++) {
      var ownText = "";
      for (var j = 0; j < btns[i].childNodes.length; j++) {
        if (btns[i].childNodes[j].nodeType === 3) ownText += btns[i].childNodes[j].textContent;
      }
      if (ownText.trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 30 && r.y < 200) {
          btns[i].click();
          return true;
        }
      }
    }
    return false;
  })()`);
  await page.waitForTimeout(1500);
  
  await page.screenshot({ path: path.join(OUTPUT_DIR, "diag-actions-clicked.png") });

  // AFTER clicking Actions, dump ALL elements near the Actions button area
  console.log("\n=== AFTER ACTIONS CLICK ===");
  const nearbyElements = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      // Look for elements in the dropdown area (near x=1200-1400, y=130-400)
      if (r.width > 0 && r.height > 0 && r.x > 1000 && r.y > 100 && r.y < 500) {
        var ownText = "";
        for (var j = 0; j < all[i].childNodes.length; j++) {
          if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent;
        }
        ownText = ownText.trim();
        if (ownText.length > 0 && ownText.length < 80) {
          results.push({
            tag: all[i].tagName,
            cls: (all[i].className || "").toString().slice(0, 80),
            text: ownText,
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            role: all[i].getAttribute("role"),
          });
        }
      }
    }
    return results;
  })()`);
  
  for (const el of nearbyElements as any[]) {
    console.log(`  <${el.tag}> "${el.text}" @(${el.x},${el.y}) ${el.w}x${el.h} cls="${el.cls}" role=${el.role}`);
  }

  // Also check for any portal/overlay elements
  console.log("\n=== PORTALS/OVERLAYS ===");
  const portals = await page.evaluate(`(function(){
    var results = [];
    var overlays = document.querySelectorAll("[class*='portal'], [class*='Portal'], [class*='overlay'], [class*='Overlay'], [class*='popover'], [class*='Popover'], [class*='dropdown-menu'], [class*='DropdownMenu']");
    for (var i = 0; i < overlays.length; i++) {
      var r = overlays[i].getBoundingClientRect();
      results.push({
        tag: overlays[i].tagName,
        cls: (overlays[i].className || "").toString().slice(0, 100),
        text: (overlays[i].textContent || "").slice(0, 200),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        children: overlays[i].children.length,
      });
    }
    return results;
  })()`);
  for (const p of portals as any[]) {
    console.log(`  <${p.tag}> cls="${p.cls}" text="${p.text.slice(0,100)}" @(${p.x},${p.y}) ${p.w}x${p.h} children=${p.children}`);
  }

  // Also check for any absolutely positioned elements that appeared
  console.log("\n=== ABSOLUTE/FIXED POSITIONED NEAR TOP-RIGHT ===");
  const positioned = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var style = window.getComputedStyle(all[i]);
      if (style.position === "absolute" || style.position === "fixed") {
        var r = all[i].getBoundingClientRect();
        if (r.width > 30 && r.height > 30 && r.x > 900 && r.y > 80 && r.y < 500) {
          var text = (all[i].textContent || "").replace(/\\s+/g, " ").trim();
          if (text.length > 0 && text.length < 300) {
            results.push({
              tag: all[i].tagName,
              cls: (all[i].className || "").toString().slice(0, 100),
              text: text.slice(0, 150),
              x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
              pos: style.position,
              zIndex: style.zIndex,
            });
          }
        }
      }
    }
    return results;
  })()`);
  for (const p of positioned as any[]) {
    console.log(`  <${p.tag}> [${p.pos} z=${p.zIndex}] "${p.text.slice(0,80)}" @(${p.x},${p.y}) ${p.w}x${p.h} cls="${p.cls}"`);
  }

  await browser.close();
})();
