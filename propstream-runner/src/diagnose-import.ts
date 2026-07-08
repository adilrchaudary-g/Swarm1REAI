/**
 * Diagnostic script: click Import List and inspect the resulting dialog.
 */
import { loadConfig } from "./config.js";
import { PropStreamRunner } from "./runner.js";

async function main() {
  const config = { ...loadConfig(), headless: false };
  const runner = await PropStreamRunner.create(config);
  await runner.waitForManualSearchReady();

  const ps = (runner as any).propstream;
  await ps.ensureReady();
  const browser = (runner as any).browser;
  const page = await browser.getPage();

  // Navigate to marketing lists page
  await browser.gotoSavedListPage();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5_000);
  await ps.dismissBlockingOverlays(page).catch(() => undefined);

  // Click Import List button
  const importRect = await page.evaluate(`(function(){
    var all = document.querySelectorAll("div, span, button");
    for (var i = 0; i < all.length; i++) {
      var ownText = "";
      for (var j = 0; j < all[i].childNodes.length; j++) {
        if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent;
      }
      ownText = ownText.trim();
      if (/^import\\s*list$/i.test(ownText)) {
        var btn = all[i].closest("button") || all[i].closest("[role='button']") || all[i];
        var r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: ownText };
        }
      }
    }
    return null;
  })()`);

  if (!importRect) {
    console.error("Import List button not found!");
    await runner.shutdown();
    return;
  }

  console.log("Clicking Import List at:", importRect);
  await page.mouse.click((importRect as any).x, (importRect as any).y);

  // Wait for dialog to fully render
  await page.waitForTimeout(5_000);
  await browser.screenshot("diag-02-after-import-click");

  // Find all visible modals/dialogs
  const modals = await page.evaluate(`(function(){
    var results = [];
    var modals = document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="Modal"]');
    for (var i = 0; i < modals.length; i++) {
      var r = modals[i].getBoundingClientRect();
      if (r.width > 50 && r.height > 50) {
        var text = (modals[i].textContent || "").replace(/\\s+/g, " ").trim();
        results.push({
          tag: modals[i].tagName,
          class: (modals[i].className || "").toString().slice(0, 200),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          textPreview: text.slice(0, 300),
          hasFileInput: modals[i].querySelectorAll('input[type="file"]').length,
          hasDropzone: modals[i].querySelectorAll('[class*="drop"], [class*="upload"], [class*="drag"]').length,
          inputs: Array.from(modals[i].querySelectorAll("input")).map(function(el) {
            var ir = el.getBoundingClientRect();
            return { type: el.type, name: el.name, placeholder: el.placeholder, visible: ir.width > 0 };
          }),
          buttons: Array.from(modals[i].querySelectorAll("button")).map(function(el) {
            var br = el.getBoundingClientRect();
            return { text: (el.textContent || "").trim().slice(0, 50), visible: br.width > 0, disabled: el.disabled };
          }).filter(function(b) { return b.visible; })
        });
      }
    }
    return results;
  })()`) as unknown[];
  console.log("\n=== Visible modals after Import List click ===");
  console.log(JSON.stringify(modals, null, 2));

  // Also check if there's an iframe that might contain the import UI
  const iframes = await page.evaluate(`(function(){
    var frames = document.querySelectorAll("iframe");
    var results = [];
    for (var i = 0; i < frames.length; i++) {
      var r = frames[i].getBoundingClientRect();
      results.push({
        src: frames[i].src || "none",
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
    return results;
  })()`) as unknown[];
  console.log("\n=== Iframes ===");
  console.log(JSON.stringify(iframes, null, 2));

  // Check the full DOM for any file input (even hidden)
  const fileInputs = await page.evaluate(`(function(){
    var inputs = document.querySelectorAll('input[type="file"]');
    var results = [];
    for (var i = 0; i < inputs.length; i++) {
      var r = inputs[i].getBoundingClientRect();
      var parent = inputs[i].parentElement;
      results.push({
        name: inputs[i].name,
        accept: inputs[i].accept,
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        parentTag: parent ? parent.tagName : null,
        parentClass: parent ? (parent.className || "").toString().slice(0, 100) : null,
        style: inputs[i].style.cssText.slice(0, 200),
        hidden: inputs[i].hidden,
        display: window.getComputedStyle(inputs[i]).display
      });
    }
    return results;
  })()`) as unknown[];
  console.log("\n=== All file inputs (including hidden) ===");
  console.log(JSON.stringify(fileInputs, null, 2));

  // Check for any elements with "upload", "drag", "drop", "browse", "choose" text
  const uploadElements = await page.evaluate(`(function(){
    var results = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var ownText = "";
      for (var j = 0; j < all[i].childNodes.length; j++) {
        if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent;
      }
      ownText = ownText.trim();
      if (/browse|choose file|drag.*drop|upload.*file|select.*file|csv/i.test(ownText) && ownText.length < 100) {
        var r = all[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          results.push({
            tag: all[i].tagName,
            text: ownText,
            class: (all[i].className || "").toString().slice(0, 100),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
          });
        }
      }
    }
    return results;
  })()`) as unknown[];
  console.log("\n=== Upload/browse/drag-drop elements ===");
  console.log(JSON.stringify(uploadElements, null, 2));

  // Take a zoomed screenshot of the center of the page where the modal should be
  await page.waitForTimeout(2_000);
  await browser.screenshot("diag-03-modal-detail");

  await runner.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
