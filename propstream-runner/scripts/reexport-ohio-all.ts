import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";

const RUNTIME_PROFILE = path.join(process.cwd(), ".runtime", "profile");
const USERNAME = "erdemkaradayi27@gmail.com";
const PASSWORD = "ArC_2007";
const ACQUISITION_ROOT = path.join(os.homedir(), "Desktop", "wholesaling-swarm", "lead-vault", "acquisition", "propstream");

const COUNTIES = [
  { slug: "hamilton-county-oh-all", date: "2026-05-06" },
  { slug: "summit-county-oh-all", date: "2026-05-06" },
  { slug: "lucas-county-oh-all", date: "2026-05-06" },
  { slug: "stark-county-oh-all", date: "2026-05-06" },
  { slug: "butler-county-oh-all", date: "2026-05-06" },
  { slug: "lorain-county-oh-all", date: "2026-05-06" },
  { slug: "mahoning-county-oh-all", date: "2026-05-06" },
  { slug: "lake-county-oh-all", date: "2026-05-06" },
  { slug: "trumbull-county-oh-all", date: "2026-05-06" },
  { slug: "cuyahoga-county-oh-all", date: "2026-05-06" },
  { slug: "franklin-county-oh-all", date: "2026-05-06" },
  { slug: "warren-county-oh-all", date: "2026-05-06" },
  { slug: "clark-county-oh-all", date: "2026-05-06" },
  { slug: "greene-county-oh-all", date: "2026-05-06" },
];

const SIGNALS = ["pre-foreclosure", "tax-delinquent", "probate"];

async function dismissOverlays(page: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cb = page.locator('[class*="Alert-style"] input[type="checkbox"]').first();
    if (await cb.count().catch(() => 0)) {
      if (!(await cb.isChecked().catch(() => true))) await cb.check({ force: true }).catch(() => undefined);
    }
    const close = page.locator('[class*="Alert-style"] button').filter({ hasText: /^close$/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2000);
    } else break;
  }
  await page.evaluate(`(function(){
    document.querySelectorAll('[class*="modalOverlay"], [class*="modal-backdrop"]').forEach(function(el){ el.remove(); });
    document.body.classList.remove("bodyModal");
    document.body.style.overflow = "auto";
  })()`).catch(() => undefined);
}

async function navigateToList(page: any, listName: string): Promise<string | null> {
  await page.goto("https://app.propstream.com/property/group", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await page.waitForTimeout(1500);

  const labelIndex = await page.evaluate((name: string) => {
    const labels = Array.from(document.querySelectorAll('[class*="labelName"]'));
    return labels.findIndex((el) => (el.textContent || "").trim() === name);
  }, listName);

  if (labelIndex < 0) {
    console.log(`  List not found: ${listName}`);
    return null;
  }

  const target = page.locator('[class*="labelName"]').nth(labelIndex);
  await target.dispatchEvent("click");
  await page.waitForTimeout(1500);
  const clickUrl = page.url();

  const groupIdMatch = clickUrl.match(/property\/group\/[^/]+\/(\d+)/);
  if (groupIdMatch) {
    const groupId = groupIdMatch[1];
    await page.goto(`https://app.propstream.com/property/group/${groupId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);
    return groupId;
  }

  return null;
}

async function getListTotal(page: any): Promise<number> {
  const total = await page.evaluate(`(function(){
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var ownText = "";
      for (var j = 0; j < els[i].childNodes.length; j++) {
        if (els[i].childNodes[j].nodeType === 3) ownText += els[i].childNodes[j].textContent;
      }
      var m = ownText.trim().match(/^Total\\s*(\\d[\\d,]*)/i);
      if (m) return parseInt(m[1].replace(/,/g, ""));
    }
    return -1;
  })()`);
  return total as number;
}

async function exportListCsv(page: any): Promise<string | null> {
  // Select all via header checkbox
  const headerCells = page.locator('.ag-header-cell[col-id="resultIndex"]');
  for (let i = 0; i < await headerCells.count().catch(() => 0); i++) {
    const box = await headerCells.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x > 10) {
      await page.mouse.click(box.x + 12, box.y + box.height / 2);
      await page.waitForTimeout(500);
      break;
    }
  }

  // Actions → Export CSV
  const actionsRect = await page.evaluate(`(function(){
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").trim() === "Actions") {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 50 && r.y < 250) return { x: r.x+r.width/2, y: r.y+r.height/2 };
      }
    }
    return null;
  })()`) as { x: number; y: number } | null;

  if (!actionsRect) {
    console.log("  Actions button not found");
    return null;
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.mouse.click(actionsRect.x, actionsRect.y);
  await page.waitForTimeout(1000);

  const exportCsv = page.getByText("Export CSV", { exact: true }).last();
  if (await exportCsv.isVisible().catch(() => false)) {
    await exportCsv.click();
  } else {
    console.log("  Export CSV option not found");
    return null;
  }

  await page.waitForTimeout(2000);
  const download = await downloadPromise.catch(() => null);
  if (!download) {
    console.log("  Download did not start");
    return null;
  }

  const dlPath = await download.path();
  if (!dlPath) return null;
  return fs.readFileSync(dlPath, "utf8");
}

(async () => {
  const browser = await chromium.launchPersistentContext(RUNTIME_PROFILE, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  const page = browser.pages()[0] || await browser.newPage();

  // Login
  await page.goto("https://login.propstream.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (await page.locator('input[type="password"]').count().catch(() => 0)) {
    await page.locator('input[name="username"], input[type="email"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"], .gradient-btn, button:has-text("Login")').first().click({ force: true });
    await page.waitForTimeout(8000);
  }
  await dismissOverlays(page);
  console.log("Logged in.\n");

  let totalReexported = 0;

  for (const county of COUNTIES) {
    console.log(`\n=== ${county.slug} ===`);
    const harvestDir = path.join(ACQUISITION_ROOT, county.slug, county.date);

    if (!fs.existsSync(harvestDir)) {
      console.log(`  Harvest dir not found: ${harvestDir}`);
      continue;
    }

    for (const signal of SIGNALS) {
      const listName = `swarm-${county.slug.replace("-all", "")}-${signal}-all-${county.date}`;
      const csvPath = path.join(harvestDir, `${signal}.csv`);

      console.log(`  Re-exporting: ${listName}`);

      try {
        const groupId = await navigateToList(page, listName);
        if (!groupId) {
          console.log(`    Skipped (list not found)`);
          continue;
        }

        const total = await getListTotal(page);
        console.log(`    List total: ${total}`);

        const csv = await exportListCsv(page);
        if (csv) {
          fs.writeFileSync(csvPath, csv, "utf8");
          const rows = csv.split("\n").filter((l: string) => l.trim()).length - 1;
          console.log(`    Exported ${rows} rows → ${csvPath}`);
          totalReexported += rows;
        } else {
          console.log(`    Export failed`);
        }
      } catch (err) {
        console.log(`    Error: ${err instanceof Error ? err.message : String(err)}`);
      }

      await page.waitForTimeout(2000);
    }
  }

  // Update manifests with new row counts
  for (const county of COUNTIES) {
    const harvestDir = path.join(ACQUISITION_ROOT, county.slug, county.date);
    const manifestPath = path.join(harvestDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    let totalProps = 0;
    for (const [signalName, signalInfo] of Object.entries(manifest.signals || {})) {
      const csvFile = path.join(harvestDir, (signalInfo as any).file);
      if (fs.existsSync(csvFile)) {
        const rows = fs.readFileSync(csvFile, "utf8").split("\n").filter((l: string) => l.trim()).length - 1;
        (signalInfo as any).properties = rows;
        totalProps += rows;
      }
    }
    manifest.totals.properties = totalProps;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  Updated manifest: ${county.slug} → ${totalProps} properties`);
  }

  console.log(`\n========================================`);
  console.log(`  RE-EXPORT COMPLETE: ${totalReexported} total rows`);
  console.log(`========================================`);

  await browser.close();
})();
