import { loadConfig } from "./config.js";
import { seedRunnerProfileFromChrome } from "./browser/profile-seed.js";
import { PropStreamRunner } from "./runner.js";
import { runBenchmark } from "./browser/session-benchmark.js";
import path from "node:path";
import fs from "node:fs";

async function main() {
  const config = loadConfig();
  const command = process.argv[2];

  const parseFilterFlags = (input: string | undefined) => {
    const filters: Record<string, unknown> = {};
    for (const token of String(input || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      if (token.includes("=")) {
        const [key, val] = token.split("=", 2);
        filters[key] = isNaN(Number(val)) ? val : Number(val);
      } else {
        filters[token] = true;
      }
    }
    return filters;
  };

  if (command === "bootstrap-auth") {
    const runner = await PropStreamRunner.create(config);
    await runner.bootstrapAuth();
    return;
  }

  if (command === "harvest-zip") {
    const zip = process.argv[3];
    const listName = process.argv[4];
    const maxSkipTraces = Number(process.argv[5] || "100");
    if (!zip || !listName) {
      throw new Error("Usage: npm start -- harvest-zip <zip> <listName> [maxSkipTraces]");
    }
    const runner = await PropStreamRunner.create(config);
    const result = await runner.harvestZip({
      zip,
      listName,
      maxSkipTraces,
      maxResults: maxSkipTraces,
    });
    console.log(JSON.stringify(result.manifest, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "interactive-harvest-zip") {
    const zip = process.argv[3];
    const listName = process.argv[4];
    const maxSkipTraces = Number(process.argv[5] || "100");
    if (!zip || !listName) {
      throw new Error("Usage: npm start -- interactive-harvest-zip <zip> <listName> [maxSkipTraces]");
    }
    const interactiveConfig = {
      ...config,
      headless: false,
    };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();
    const result = await runner.harvestZipInLiveSession({
      zip,
      listName,
      maxSkipTraces,
      maxResults: maxSkipTraces,
      filters: {
        vacant: true,
        sfr_detached: true,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "distressed-harvest") {
    const zip = process.argv[3];
    const listName = process.argv[4] || "distressed";
    const maxSkipTraces = Number(process.argv[5] || "3000");
    const maxPrice = Number(process.argv[6] || "500000");
    if (!zip) {
      throw new Error("Usage: npm start -- distressed-harvest <zip> [listName] [maxSkipTraces] [maxPrice]");
    }
    const interactiveConfig = {
      ...config,
      headless: false,
    };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();
    const results = await runner.harvestMultiDistress(
      {
        zip,
        listName,
        maxSkipTraces,
        maxResults: maxSkipTraces,
        filters: {
          vacant: true,
          sfr_detached: true,
          equity_min: 50,
          max_price: maxPrice,
        },
      },
      ["pre_foreclosure", "tax_delinquent", "probate"],
    );
    console.log("\n=== FINAL RESULTS ===");
    console.log(JSON.stringify(results, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "lead-harvest") {
    const positionalArgs = process.argv.slice(3).filter((a) => !a.startsWith("--"));
    const flagArgs = process.argv.slice(3).filter((a) => a.startsWith("--"));
    const noVacant = flagArgs.includes("--no-vacant");

    const searchTerm = positionalArgs[0];
    const county = positionalArgs[1] || searchTerm;
    const maxPerSignal = Number(positionalArgs[2] || "1000");
    const signalsArg = positionalArgs[3] || "pre_foreclosure,tax_delinquent,probate";
    if (!searchTerm) {
      throw new Error("Usage: npm start -- lead-harvest <zip-or-county> [county-slug] [maxPerSignal] [signals] [--no-vacant]");
    }

    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    const allSignals = ["pre_foreclosure", "tax_delinquent", "probate"];
    const signals = signalsArg.split(",").filter((s) => allSignals.includes(s.trim()));
    const signalFileNames: Record<string, string> = {
      pre_foreclosure: "pre-foreclosure",
      tax_delinquent: "tax-delinquent",
      probate: "probate",
    };

    const date = new Date().toISOString().slice(0, 10);
    const countySlug = county.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const harvestSubdir = noVacant ? `${countySlug}-all` : countySlug;
    const harvestDir = path.join(
      config.harvestArchiveRoot, harvestSubdir, date,
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(harvestDir, { recursive: true });

    const activeFilters = noVacant ? [] : ["Vacant"];
    const manifest: Record<string, unknown> = {
      harvest_date: date,
      county: county,
      source: "PropStream",
      filters: activeFilters,
      dnc_stripped: true,
      signals: {} as Record<string, unknown>,
      totals: { properties: 0, with_callable_phone: 0, callable_rate: "0%", dnc_numbers_removed: 0 },
    };

    let totalProps = 0;

    for (const signal of signals) {
      const listName = `swarm-${countySlug}-${signalFileNames[signal]}-${noVacant ? "all-" : ""}${date}`;
      const csvPath = path.join(harvestDir, `${signalFileNames[signal]}.csv`);

      console.log(`\n=== ${signal.toUpperCase()} ${noVacant ? "(no vacant filter)" : ""} ===`);
      console.log(`List: ${listName}`);

      const searchFilters: Record<string, unknown> = { [signal]: true };
      if (!noVacant) searchFilters.vacant = true;

      try {
        const { discovered, saved } = await runner.searchAndSaveAll(
          searchTerm,
          searchFilters,
          listName,
          maxPerSignal,
        );
        console.log(`Saved ${saved}/${discovered} to list`);

        if (saved > 0) {
          const waitSec = saved >= 1000 ? 180 : saved >= 500 ? 120 : saved >= 200 ? 70 : 30;
          console.log(`Waiting ${waitSec}s for PropStream to process bulk save of ${saved}...`);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          console.log(`Skip tracing ${listName}...`);
          await runner.skipTraceList(listName, saved);
          console.log(`Skip trace complete`);

          const balance = await runner.checkSkipTraceBalance();
          console.log(`[BALANCE] Skip traces remaining: ${balance.skip_trace ?? "unknown"} | Saves: ${balance.saves ?? "unknown"} | Exports: ${balance.exports ?? "unknown"}`);

          const csvContent = runner.lastExportCsv;
          if (csvContent) {
            const { writeFile: wf } = await import("node:fs/promises");
            await wf(csvPath, csvContent, "utf8");
            const rows = csvContent.split("\n").filter((l: string) => l.trim()).length - 1;
            console.log(`Saved ${rows} rows to ${csvPath}`);
            const signalInfo: Record<string, unknown> = {
              file: `${signalFileNames[signal]}.csv`,
              properties: rows,
            };
            (manifest.signals as Record<string, unknown>)[signalFileNames[signal]] = signalInfo;
            totalProps += rows;
          } else {
            console.log(`Fallback: exporting CSV separately...`);
            const csvResult = await runner.exportListCsv(listName, csvPath);
            console.log(`Exported ${csvResult.rows} rows`);
            const signalInfo: Record<string, unknown> = {
              file: `${signalFileNames[signal]}.csv`,
              properties: csvResult.rows,
            };
            (manifest.signals as Record<string, unknown>)[signalFileNames[signal]] = signalInfo;
            totalProps += csvResult.rows;
          }
        } else {
          console.log(`No results for ${signal}`);
        }
      } catch (error) {
        console.error(`${signal} FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    (manifest.totals as Record<string, unknown>).properties = totalProps;
    console.log(`\n=== DNC STRIP ===`);
    const { execSync } = await import("node:child_process");
    const stripScript = path.join(config.appRoot, "scripts", "strip-dnc.py");
    const csvFiles = allSignals
      .map((s) => path.join(harvestDir, `${signalFileNames[s]}.csv`))
      .filter((p) => fs.existsSync(p));
    if (csvFiles.length) {
      try {
        const stripOutput = execSync(`python3 "${stripScript}" ${csvFiles.map(p => `"${p}"`).join(" ")}`, { encoding: "utf8" });
        console.log(stripOutput);
      } catch (e) {
        console.error(`DNC strip warning: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const { writeFile: writeFileAsync } = await import("node:fs/promises");
    await writeFileAsync(path.join(harvestDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written to ${harvestDir}/manifest.json`);
    console.log(`Total properties: ${totalProps}`);
    console.log(`\nTo process through lead engine:`);
    console.log(`  cd ~/Desktop/wholesaling-swarm && python3 -m lead_engine run --harvest ${harvestDir}`);

    await runner.shutdown();
    return;
  }

  if (command === "reexport") {
    const listNamesArg = process.argv[3];
    const outputDir = process.argv[4];
    if (!listNamesArg || !outputDir) {
      throw new Error("Usage: npm start -- reexport <listName1,listName2,...> <outputDir>");
    }

    const listNames = listNamesArg.split(",").map(s => s.trim()).filter(Boolean);
    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    const { mkdir: mkdirAsync, writeFile: writeFileAsync } = await import("node:fs/promises");
    await mkdirAsync(outputDir, { recursive: true });

    let totalRows = 0;
    for (const listName of listNames) {
      const csvPath = path.join(outputDir, `${listName}.csv`);
      console.log(`\nRe-exporting: ${listName}`);
      try {
        const result = await runner.exportListCsv(listName, csvPath);
        console.log(`  → ${result.rows} rows → ${csvPath}`);
        totalRows += result.rows;
      } catch (error) {
        console.error(`  → FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\nRe-export complete: ${totalRows} total rows`);
    await runner.shutdown();
    return;
  }

  if (command === "skip-trace-lists") {
    const listNamesArg = process.argv[3];
    if (!listNamesArg) {
      throw new Error("Usage: npm start -- skip-trace-lists <listName1,listName2,...>");
    }

    const listNames = listNamesArg.split(",").map(s => s.trim()).filter(Boolean);
    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    let ordered = 0;
    for (const listName of listNames) {
      console.log(`\nSkip tracing: ${listName}`);
      try {
        await runner.skipTraceList(listName, 210);
        console.log(`  → Ordered`);
        ordered++;
      } catch (error) {
        console.error(`  → FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\nSkip trace complete: ${ordered}/${listNames.length} orders placed`);
    await runner.shutdown();
    return;
  }

  if (command === "scout-county") {
    const searchTerm = process.argv[3];
    if (!searchTerm) {
      throw new Error('Usage: npm start -- scout-county "Hamilton County OH"');
    }
    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    console.log(`\n=== SCOUTING: ${searchTerm} ===`);
    const results = await runner.scoutCounty(searchTerm);
    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`\nResults for ${searchTerm}:`);
    for (const r of results) {
      console.log(`  ${r.signal}: ${r.count.toLocaleString()} properties`);
    }
    console.log(`  TOTAL DISTRESSED: ${total.toLocaleString()}`);
    console.log(JSON.stringify({ search_term: searchTerm, signals: results, total_distressed: total }));
    await runner.shutdown();
    return;
  }

  if (command === "bulk-scout") {
    const batchFile = process.argv[3];
    const outputFileArg = process.argv[4];
    if (!batchFile) {
      throw new Error("Usage: npm start -- bulk-scout <batch-json-path> [output-json-path]");
    }
    const batchData: Array<{ fips: string; search_term: string }> = JSON.parse(
      fs.readFileSync(batchFile, "utf8"),
    );
    if (!batchData.length) {
      throw new Error("Batch file is empty");
    }

    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    const date = new Date().toISOString().slice(0, 10);
    const defaultOutDir = path.join(config.harvestArchiveRoot, "..", "scouting", date);
    const outPath = outputFileArg
      ? path.resolve(outputFileArg)
      : path.join(defaultOutDir, "results.json");
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });

    const allResults: Array<{
      fips: string;
      search_term: string;
      signals: Array<{ signal: string; count: number }>;
      total_distressed: number;
      scouted_at: string;
    }> = [];

    console.log(`\n=== BULK SCOUT: ${batchData.length} counties ===\n`);
    for (const [idx, entry] of batchData.entries()) {
      console.log(`[${idx + 1}/${batchData.length}] Scouting ${entry.search_term}...`);
      try {
        const results = await runner.scoutCounty(entry.search_term);
        const total = results.reduce((sum, r) => sum + r.count, 0);
        allResults.push({
          fips: entry.fips,
          search_term: entry.search_term,
          signals: results,
          total_distressed: total,
          scouted_at: new Date().toISOString(),
        });
        console.log(`  → ${total.toLocaleString()} distressed properties`);
      } catch (error) {
        console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
        allResults.push({
          fips: entry.fips,
          search_term: entry.search_term,
          signals: [],
          total_distressed: 0,
          scouted_at: new Date().toISOString(),
        });
      }
    }

    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log(`\nScouting complete. ${allResults.length} counties scouted.`);
    console.log(`Results written to: ${outPath}`);

    const ranked = [...allResults].sort((a, b) => b.total_distressed - a.total_distressed);
    console.log(`\nTop 10 by distressed count:`);
    for (const r of ranked.slice(0, 10)) {
      console.log(`  ${r.search_term}: ${r.total_distressed.toLocaleString()}`);
    }

    await runner.shutdown();
    return;
  }

  if (command === "bulk-harvest") {
    const signalArg = process.argv[3] || "pre_foreclosure";
    const maxPerCounty = Number(process.argv[4] || "1000");
    const counties = (process.argv[5] || "").split("|").map(s => s.trim()).filter(Boolean);
    if (!counties.length) {
      throw new Error("Usage: npm start -- bulk-harvest <signal> <maxPerCounty> 'county1|county2|...'");
    }

    const signalFileNames: Record<string, string> = {
      pre_foreclosure: "pre-foreclosure",
      tax_delinquent: "tax-delinquent",
      probate: "probate",
    };
    const signalFileName = signalFileNames[signalArg] || signalArg;
    const date = new Date().toISOString().slice(0, 10);
    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    type ListEntry = { county: string; slug: string; listName: string; saved: number; discovered: number };
    const lists: ListEntry[] = [];

    // Phase 1: Save all lists quickly (no waiting between)
    console.log(`\n=== PHASE 1: BULK SAVE (${counties.length} counties) ===`);
    for (const county of counties) {
      const slug = county.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const listName = `swarm-${slug}-${signalFileName}-${date}`;
      console.log(`\n[${county}] Searching ${signalArg}...`);
      try {
        const { discovered, saved } = await runner.searchAndSaveAll(
          county,
          { vacant: true, [signalArg]: true },
          listName,
          maxPerCounty,
        );
        console.log(`[${county}] Saved ${saved}/${discovered} to ${listName}`);
        lists.push({ county, slug, listName, saved, discovered });
      } catch (error) {
        console.error(`[${county}] FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Phase 2: Wait for PropStream to process all saves
    const waitMin = 5;
    console.log(`\n=== PHASE 2: WAITING ${waitMin} MIN FOR PROPSTREAM TO PROCESS ===`);
    for (let i = waitMin * 60; i > 0; i -= 30) {
      process.stdout.write(`\r  ${Math.ceil(i/60)} min remaining...   `);
      await new Promise((r) => setTimeout(r, 30000));
    }
    console.log(`\n  Done waiting.`);

    // Phase 3: Skip trace + export each list
    console.log(`\n=== PHASE 3: SKIP TRACE + EXPORT ===`);
    const harvestRoot = config.harvestArchiveRoot;
    let grandTotal = 0;

    for (const entry of lists) {
      const harvestDir = path.join(harvestRoot, entry.slug, date);
      const { mkdir: mkdirAsync } = await import("node:fs/promises");
      await mkdirAsync(harvestDir, { recursive: true });
      const csvPath = path.join(harvestDir, `${signalFileName}.csv`);

      console.log(`\n[${entry.county}] Skip tracing ${entry.listName}...`);
      try {
        await runner.skipTraceList(entry.listName);
        const balance = await runner.checkSkipTraceBalance();
        console.log(`[${entry.county}] [BALANCE] Skip traces remaining: ${balance.skip_trace ?? "unknown"}`);
        const csvContent = runner.lastExportCsv;
        if (csvContent) {
          const { writeFile: wf } = await import("node:fs/promises");
          await wf(csvPath, csvContent, "utf8");
          const rows = csvContent.split("\n").filter((l: string) => l.trim()).length - 1;
          console.log(`[${entry.county}] Exported ${rows} rows`);

          // DNC strip
          const { execSync } = await import("node:child_process");
          const stripScript = path.join(config.appRoot, "scripts", "strip-dnc.py");
          try {
            const stripOut = execSync(`python3 "${stripScript}" "${csvPath}"`, { encoding: "utf8" });
            console.log(`[${entry.county}] ${stripOut.trim()}`);
          } catch (e) { /* ok */ }

          // Write manifest
          const manifest = {
            harvest_date: date,
            county: entry.county,
            source: "PropStream",
            filters: ["Vacant"],
            dnc_stripped: true,
            signals: { [signalFileName]: { file: `${signalFileName}.csv`, properties: rows } },
            totals: { properties: rows },
          };
          await wf(path.join(harvestDir, "manifest.json"), JSON.stringify(manifest, null, 2));
          grandTotal += rows;
        } else {
          console.log(`[${entry.county}] No CSV captured`);
        }
      } catch (error) {
        console.error(`[${entry.county}] Export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\n=== BULK HARVEST COMPLETE ===`);
    console.log(`Total properties exported: ${grandTotal} across ${lists.length} counties`);
    console.log(`\nTo process through lead engine:`);
    for (const entry of lists) {
      const dir = path.join(harvestRoot, entry.slug, date);
      if (fs.existsSync(path.join(dir, "manifest.json"))) {
        console.log(`  python3 -m lead_engine run --harvest ${dir}`);
      }
    }
    await runner.shutdown();
    return;
  }

  if (command === "interactive-search") {
    const zip = process.argv[3];
    const filterFlags = process.argv[4];
    const maxResults = Number(process.argv[5] || "10");
    if (!zip) {
      throw new Error("Usage: npm start -- interactive-search <zip> [filter1,filter2,...] [maxResults]");
    }
    const interactiveConfig = {
      ...config,
      headless: false,
    };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();
    const result = await runner.interactiveSearch({
        command_type: "SEARCH",
        zip,
        filters: parseFilterFlags(filterFlags),
        max_results: maxResults,
    });
    const state = await runner.interactivePageState().catch(() => null);
    console.log(JSON.stringify({ result, state }, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "interactive-state") {
    const interactiveConfig = {
      ...config,
      headless: false,
    };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();
    const state = await runner.interactivePageState().catch(() => null);
    console.log(JSON.stringify({ state }, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "interactive-raw") {
    const interactiveConfig = {
      ...config,
      headless: false,
    };
    const runner = await PropStreamRunner.create(interactiveConfig);
    const page = await (runner as any).browser.getPage();
    const raw = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      body: (document.body?.innerText || "").slice(0, 2000),
    }));
    console.log(JSON.stringify(raw, null, 2));
    await runner.shutdown();
    return;
  }

  if (command === "import-skip-trace") {
    const csvPathArg = process.argv[3];
    const listNameArg = process.argv[4] || `swarm-skip-${new Date().toISOString().slice(0, 10)}`;
    const hermesUrl = process.env.HERMES_BASE_URL || "http://localhost:8765";

    if (!csvPathArg) {
      throw new Error(
        "Usage: npm start -- import-skip-trace <csvPath> [listName]\n" +
        "  csvPath: Path to CSV with Address,City,State,Zip columns\n" +
        "  listName: Name for PropStream marketing list (default: swarm-skip-YYYY-MM-DD)"
      );
    }

    const csvPath = path.resolve(csvPathArg);
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found: ${csvPath}`);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n").filter(l => l.trim()).length - 1;
    console.log(`\n=== IMPORT-SKIP-TRACE PIPELINE ===`);
    console.log(`CSV: ${csvPath} (${csvLines} addresses)`);
    console.log(`List: ${listNameArg}`);

    const interactiveConfig = { ...config, headless: false };
    const runner = await PropStreamRunner.create(interactiveConfig);
    await runner.waitForManualSearchReady();

    // Phase 1: Import CSV into PropStream as a marketing list
    console.log(`\n--- PHASE 1: Import CSV to PropStream ---`);
    let importSucceeded = false;
    for (let importAttempt = 1; importAttempt <= 2; importAttempt++) {
      try {
        const importResult = await runner.importCsvToList(csvPath, listNameArg);
        console.log(`Imported: ${importResult.imported} records to list "${importResult.listName}"`);
        importSucceeded = true;
        break;
      } catch (error) {
        console.error(`Import attempt ${importAttempt} failed: ${error instanceof Error ? error.message : String(error)}`);
        if (importAttempt < 2) {
          console.log(`Retrying import in 10s...`);
          await new Promise(r => setTimeout(r, 10_000));
        }
      }
    }
    if (!importSucceeded) {
      console.error(`ABORT: Import failed after 2 attempts — cannot proceed without a list`);
      await runner.shutdown();
      return;
    }

    // Phase 2: Poll for PropStream to process the import (instead of blind wait)
    const maxImportWaitMs = csvLines >= 2000 ? 120_000 : csvLines >= 1000 ? 90_000 : 45_000;
    console.log(`\n--- PHASE 2: Polling for import completion (max ${maxImportWaitMs / 1000}s) ---`);
    const importPollStart = Date.now();
    while (Date.now() - importPollStart < maxImportWaitMs) {
      try {
        const page = await (runner as any).browser.getPage();
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (/(\d[\d,]*)\s*(?:records?|properties|rows?)\s*(?:imported|matched|added|processed|found)/i.test(bodyText)) {
          console.log(`[import] Processing complete detected after ${Math.round((Date.now() - importPollStart) / 1000)}s`);
          break;
        }
        if (/saved|success|complete/i.test(bodyText) && !/processing|loading|importing/i.test(bodyText)) {
          console.log(`[import] Success indicator found after ${Math.round((Date.now() - importPollStart) / 1000)}s`);
          break;
        }
      } catch { /* page may be navigating */ }
      await new Promise(r => setTimeout(r, 5_000));
    }

    // Phase 3: Navigate to the list and check how many PropStream matched, then order skip trace
    console.log(`\n--- PHASE 3: Order Skip Trace ---`);
    try {
      await runner.skipTraceOrderOnly(listNameArg, csvLines);
      console.log(`Skip trace order placed for "${listNameArg}"`);
    } catch (error) {
      console.error(`Skip trace order failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`The skip trace may need to be ordered manually in PropStream.`);
    }

    const balance = await runner.checkSkipTraceBalance();
    console.log(`[BALANCE] Skip traces remaining: ${balance.skip_trace ?? "unknown"} | Saves: ${balance.saves ?? "unknown"} | Exports: ${balance.exports ?? "unknown"}`);

    // Phase 4: Poll for skip trace completion, then export with phone verification
    const maxSkipWaitMs = csvLines >= 2000 ? 180_000 : csvLines >= 1000 ? 120_000 : 60_000;
    const skipPollInterval = 15_000;
    console.log(`\n--- PHASE 4: Polling for skip trace data (max ${maxSkipWaitMs / 1000}s) ---`);
    const skipPollStart = Date.now();
    let skipDataReady = false;
    while (Date.now() - skipPollStart < maxSkipWaitMs) {
      try {
        const page = await (runner as any).browser.getPage();
        const rowCount = await page.locator(".ag-row").count().catch(() => 0);
        const bodyText = await page.locator("body").innerText().catch(() => "");
        const hasPhoneColumn = /phone/i.test(bodyText);
        if (rowCount > 0 && hasPhoneColumn) {
          console.log(`[skip-trace] Grid has ${rowCount} rows with phone column after ${Math.round((Date.now() - skipPollStart) / 1000)}s`);
          skipDataReady = true;
          break;
        }
        if (/skip trace.*complete|trace.*done/i.test(bodyText)) {
          console.log(`[skip-trace] Completion indicator found after ${Math.round((Date.now() - skipPollStart) / 1000)}s`);
          skipDataReady = true;
          break;
        }
      } catch { /* page may be navigating */ }
      await new Promise(r => setTimeout(r, skipPollInterval));
    }
    if (!skipDataReady) {
      console.log(`[skip-trace] Max wait reached (${maxSkipWaitMs / 1000}s) — proceeding to export anyway`);
    }

    const { mkdir } = await import("node:fs/promises");
    const archiveRoot = config.harvestArchiveRoot;
    const date = new Date().toISOString().slice(0, 10);
    const exportDir = path.join(archiveRoot, "skip-trace-results", date);
    await mkdir(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `${listNameArg}.csv`);

    const exportResult = await runner.exportListWithPhoneCheck(listNameArg, exportPath, 8);
    if (exportResult.hasPhones) {
      console.log(`Exported ${exportResult.rows} rows with phone data to ${exportResult.path}`);
    } else {
      console.log(`WARNING: Exported but no phone data found after all attempts`);
      console.log(`PropStream may still be processing. Try re-exporting later.`);
    }

    // Phase 5: Ingest results back to Hermes
    console.log(`\n--- PHASE 5: Ingest results to Hermes ---`);
    if (fs.existsSync(exportPath)) {
      try {
        const resp = await fetch(`${hermesUrl}/api/skip-trace/ingest-csv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const result = await resp.json();
        console.log(`Hermes ingest result:`, JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Hermes ingest failed: ${error instanceof Error ? error.message : String(error)}`);
        console.log(`The exported CSV is available at: ${exportPath}`);
        console.log(`You can manually trigger ingest via: curl -X POST ${hermesUrl}/api/skip-trace/ingest-csv`);
      }
    } else {
      console.log(`No export file found. Skip trace may still be processing.`);
    }

    console.log(`\n=== PIPELINE COMPLETE ===`);
    await runner.shutdown();
    return;
  }

  if (command === "court-records") {
    const county = process.argv[3];
    const caseType = (process.argv[4] || "Probate") as "Probate" | "Civil" | "All";
    const daysBack = Number(process.argv[5] || "7");
    if (!county) {
      throw new Error(
        "Usage: npm start -- court-records <county> [caseType] [daysBack]\n" +
        "  county: Court ID / county name (e.g. 'Greene')\n" +
        "  caseType: Probate | Civil | All (default: Probate)\n" +
        "  daysBack: Number of days back to search (default: 7)",
      );
    }

    const { CaseNetClient } = await import("./acquisition/casenet-client.js");
    const { PropertyAppraiserClient } = await import("./acquisition/property-appraiser-client.js");
    const { BrowserSession } = await import("./browser/session.js");
    const { mkdir, writeFile } = await import("node:fs/promises");

    const interactiveConfig = { ...config, headless: false };
    const browser = new BrowserSession(interactiveConfig);
    const caseNet = new CaseNetClient(browser, interactiveConfig);
    const appraiser = new PropertyAppraiserClient(browser);

    console.log(`\n=== COURT RECORDS SCRAPER ===`);
    console.log(`County: ${county} | Case type: ${caseType} | Days back: ${daysBack}`);

    await caseNet.waitForCaseNetReady();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const fmt = (d: Date) => `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}/${d.getFullYear()}`;

    console.log(`\nSearching ${fmt(startDate)} → ${fmt(endDate)}...`);
    const cases = await caseNet.searchByFilingDate({
      courtId: county,
      caseType,
      startDate: fmt(startDate),
      endDate: fmt(endDate),
    });

    console.log(`\nFound ${cases.length} cases. Cross-referencing with property appraiser...`);

    const csvRows: string[] = [
      "case_number,court_id,case_type,file_date,deceased_name,pr_name,pr_address,pr_role,property_address,property_city,property_state,property_zip,apn,assessed_value,market_value,match_confidence,case_url",
    ];

    for (const c of cases) {
      let propAddr = "";
      let propCity = "";
      let propState = "MO";
      let propZip = "";
      let apn = "";
      let assessed = "";
      let market = "";
      let confidence = "";

      if (c.deceasedName) {
        const props = await appraiser.searchByOwnerName(c.deceasedName, county, "MO");
        if (props.length > 0) {
          const best = props[0];
          propAddr = best.address;
          propCity = best.city;
          propState = best.state;
          propZip = best.zip;
          apn = best.apn;
          assessed = best.assessedValue?.toString() || "";
          market = best.marketValue?.toString() || "";
          confidence = best.matchConfidence;
          console.log(`  ✓ ${c.deceasedName} → ${best.address} (${best.matchConfidence})`);
        } else {
          console.log(`  ✗ ${c.deceasedName} — no property found`);
        }
      }

      const esc = (s: string | null) => `"${(s || "").replace(/"/g, '""')}"`;
      csvRows.push(
        [
          esc(c.caseNumber), esc(c.courtId), esc(c.caseType), esc(c.fileDate),
          esc(c.deceasedName), esc(c.personalRepresentative?.name || ""),
          esc(c.personalRepresentative?.address || ""), esc(c.personalRepresentative?.role || ""),
          esc(propAddr), esc(propCity), esc(propState), esc(propZip),
          esc(apn), assessed, market, confidence, esc(c.caseUrl),
        ].join(","),
      );

      await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 500));
    }

    const date = new Date().toISOString().slice(0, 10);
    const countySlug = county.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const outputDir = path.join(config.courtRecordsArchiveRoot, countySlug, date);
    await mkdir(outputDir, { recursive: true });

    const csvPath = path.join(outputDir, "court-records.csv");
    await writeFile(csvPath, csvRows.join("\n"), "utf8");

    const manifest = {
      harvest_date: date,
      county,
      state: "MO",
      case_type: caseType,
      days_back: daysBack,
      source: "CaseNet",
      total_cases: cases.length,
      with_property: csvRows.length - 1 - cases.filter((c) => !c.deceasedName).length,
    };
    await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`\n=== COMPLETE ===`);
    console.log(`Cases found: ${cases.length}`);
    console.log(`CSV: ${csvPath}`);
    console.log(`Manifest: ${outputDir}/manifest.json`);

    await browser.close();
    return;
  }

  if (command === "fsbo") {
    const hermesUrl = process.env.HERMES_BASE_URL || "http://localhost:8765";

    console.log(`\n=== FSBO SCRAPER ===`);
    console.log(`Fetching active markets from Hermes...`);

    let markets: { id: number; metro: string; state: string; median_price: number | null; zillow_search_url: string | null; active: number }[];
    try {
      const resp = await fetch(`${hermesUrl}/api/fsbo/markets`);
      markets = await resp.json() as typeof markets;
    } catch (err) {
      console.error(`ERROR: Cannot reach Hermes at ${hermesUrl}. Start the server first.`);
      process.exitCode = 1;
      return;
    }

    const activeMarkets = markets.filter((m) => m.active && m.zillow_search_url);
    if (activeMarkets.length === 0) {
      console.error("ERROR: No active FSBO markets with Zillow URLs configured.");
      process.exitCode = 1;
      return;
    }

    console.log(`Found ${activeMarkets.length} active market(s): ${activeMarkets.map((m) => `${m.metro}, ${m.state}`).join(" | ")}`);

    const { ZillowFsboClient } = await import("./acquisition/zillow-fsbo-client.js");
    const { BrowserSession } = await import("./browser/session.js");
    const { mkdir, writeFile } = await import("node:fs/promises");

    const interactiveConfig = { ...config, headless: false };
    const browser = new BrowserSession(interactiveConfig);
    const zillow = new ZillowFsboClient(browser);
    await zillow.init();

    const date = new Date().toISOString().slice(0, 10);
    const allListings: Record<string, unknown>[] = [];

    for (const market of activeMarkets) {
      console.log(`\n--- ${market.metro}, ${market.state} ---`);
      console.log(`URL: ${market.zillow_search_url}`);

      try {
        const listings = await zillow.scrapeMarket(market.zillow_search_url!, {
          enrichDetail: true,
          maxPages: 10,
        });

        console.log(`[${market.metro}] Scraped ${listings.length} listings`);

        for (const l of listings) {
          allListings.push({
            ...l,
            market_metro: market.metro,
            market_state: market.state,
          });
        }

        // Write per-market CSV
        const slug = market.metro.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const marketDir = path.join(config.fsboArchiveRoot, slug, date);
        await mkdir(marketDir, { recursive: true });

        const header = "address,city,state,zip,asking_price,original_price,zestimate,days_on_market,price_drops,bedrooms,bathrooms,sqft,lot_sqft,year_built,photo_count,description,zillow_url";
        const esc = (s: string | number | null) => `"${String(s ?? "").replace(/"/g, '""')}"`;
        const rows = listings.map((l) =>
          [esc(l.address), esc(l.city), esc(l.state), esc(l.zip),
           l.asking_price ?? "", l.original_price ?? "", l.zestimate ?? "",
           l.days_on_market ?? "", l.price_drops, l.bedrooms ?? "", l.bathrooms ?? "",
           l.sqft ?? "", l.lot_sqft ?? "", l.year_built ?? "", l.photo_count ?? "",
           esc(l.description), esc(l.zillow_url)].join(",")
        );
        await writeFile(path.join(marketDir, "fsbo.csv"), [header, ...rows].join("\n"), "utf8");
        console.log(`[${market.metro}] CSV saved to ${marketDir}/fsbo.csv`);

        // Send to Hermes for import + auto-ingest
        console.log(`[${market.metro}] Importing to Hermes...`);
        try {
          const importResp = await fetch(`${hermesUrl}/api/fsbo/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              listings: listings,
              market_metro: market.metro,
              market_state: market.state,
            }),
          });
          const importResult = await importResp.json() as { imported: number; duplicates: number; scored: number };
          console.log(`[${market.metro}] Imported ${importResult.imported} (${importResult.duplicates} dupes, ${importResult.scored} scored)`);
        } catch (err) {
          console.error(`[${market.metro}] Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } catch (err) {
        console.error(`[${market.metro}] Scrape failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Auto-ingest all qualified listings
    console.log(`\n--- AUTO-INGEST ---`);
    try {
      const ingestResp = await fetch(`${hermesUrl}/api/fsbo/auto-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const ingestResult = await ingestResp.json() as { ingested: number; leads_created: number };
      console.log(`Auto-ingested ${ingestResult.ingested} listings → ${ingestResult.leads_created} leads created`);
    } catch (err) {
      console.error(`Auto-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(`\n=== FSBO SCRAPE COMPLETE ===`);
    console.log(`Total listings scraped: ${allListings.length} across ${activeMarkets.length} markets`);

    await browser.close();
    return;
  }

  if (command === "benchmark-sessions") {
    const results = await runBenchmark(config);
    console.log("\n" + JSON.stringify(results, null, 2));
    return;
  }

  if (command === "seed-profile-from-chrome") {
    await seedRunnerProfileFromChrome(config);
    console.log(
      JSON.stringify(
        {
          seeded: true,
          source: config.chromeUserDataDir,
          target: config.userDataDir,
          browser_channel: config.browserChannel,
          native_keychain: config.allowNativeKeychain,
        },
        null,
        2,
      ),
    );
    return;
  }

  const runner = await PropStreamRunner.create(config);
  await runner.run();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
