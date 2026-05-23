import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PropStreamRunner } from "../src/runner.js";
import type { RunnerConfig } from "../src/config.js";

function html(body: string, script = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PropStream Mock</title></head><body>${body}<script>${script}</script></body></html>`;
}

function searchPageHtml() {
  return html(
    `
      <main>
        <button id="filters-btn" class="dropdownToggleBtn">Filters</button>
        <input id="zip-input" placeholder="Enter County, City, Zip Code(s) or APN #" />
        <button id="search-btn" type="submit">Search</button>
        <div id="filters-panel" style="display:none">
          <button class="lead-list">Vacant</button>
          <button class="lead-list">Tax Delinquency</button>
          <button class="lead-list">Single Family</button>
        </div>
        <div class="caption">30,936 PROPERTIES</div>
        <div class="src-app-Search-Results-style__abc__wrapper">
          <div class="src-app-Search-Results-style__abc__resultsHeader">
            <div class="src-app-Search-Results-style__abc__caption">30,936 <span class="captiontxt">PROPERTIES</span></div>
            <section id="bulk-panel">
              <label><input id="master-select" type="checkbox" /> <span id="selection-label">30,936 PROPERTIES</span></label>
              <button id="actions-button" class="src-app-Search-Results-style__abc__dropdownToggleBtn">Actions</button>
              <div id="actions-menu" style="display:none">
                <button id="input-range-action">Input Range</button>
                <button id="bulk-save-action">Add to Marketing List</button>
              </div>
              <div id="range-controls" style="display:none">
                <input id="range-start" value="1" />
                <input id="range-end" value="30936" placeholder="30936" />
                <button id="show-range-button">Show Property Range</button>
              </div>
              <div>PAGE <input id="page-input" value="1" /> OF <span id="page-count">124</span></div>
            </section>
          </div>
          <div class="src-app-Search-Results-style__abc__view">
            <div class="src-app-Search-Results-style__abc__content results"></div>
          </div>
        </div>
        <div id="save-modal" role="dialog" style="display:none">
          <input placeholder="list name" />
          <ul><li data-list-option="Houston - Vacant Absentee">Houston - Vacant Absentee</li></ul>
          <button id="save-confirm">Save</button>
        </div>
        <aside id="skip-modal" style="display:none">
          <a href="tel:5551112222">555-111-2222</a>
          <a href="mailto:jane@example.com">jane@example.com</a>
        </aside>
      </main>
    `,
    `
      const properties = [
        { id: "prop-1", text: "prop-1 123 Main St, Houston, TX 77084 3 bed 2 bath" },
        { id: "prop-2", text: "prop-2 456 Oak Ave, Houston, TX 77084 4 bed 3 bath" },
      ];
      const results = document.querySelector(".results");
      const modal = document.getElementById("save-modal");
      const actionsMenu = document.getElementById("actions-menu");
      const rangeControls = document.getElementById("range-controls");
      const selectionLabel = document.getElementById("selection-label");
      const pageCount = document.getElementById("page-count");
      const rangeEnd = document.getElementById("range-end");
      const masterSelect = document.getElementById("master-select");
      let currentProperty = null;
      let rangeSize = 30936;

      function renderResults() {
        results.innerHTML = properties.map((item) => \`
          <div id="property-\${item.id}" class="src-app-Search-Results-style__abc__item" data-id="\${item.id}">
            <label class="checkboxContainer"><input type="checkbox" /></label>
            <a href="/search/\${item.id}">\${item.text}</a>
            <button class="imageIconButton save-btn">Save</button>
            <button class="skipTraceBtn">Skip Trace</button>
          </div>
        \`).join("");
        document.querySelectorAll(".save-btn").forEach((button, index) => {
          button.addEventListener("click", () => {
            currentProperty = properties[index].id;
            modal.style.display = "block";
          });
        });
        document.querySelectorAll(".skipTraceBtn").forEach((button) => {
          button.addEventListener("click", () => {
            document.getElementById("skip-modal").style.display = "block";
          });
        });
      }

      function updateSelectionLabel() {
        const checked = masterSelect.checked;
        const count = checked ? rangeSize : 30936;
        selectionLabel.textContent = checked ? \`\${count.toLocaleString()} SELECTED\` : "30,936 PROPERTIES";
      }

      document.getElementById("filters-btn").addEventListener("click", () => {
        document.getElementById("filters-panel").style.display = "block";
      });
      document.getElementById("search-btn").addEventListener("click", renderResults);
      document.getElementById("actions-button").addEventListener("click", () => {
        actionsMenu.style.display = actionsMenu.style.display === "none" ? "block" : "none";
      });
      document.getElementById("input-range-action").addEventListener("click", () => {
        rangeControls.style.display = "block";
        actionsMenu.style.display = "none";
      });
      document.getElementById("show-range-button").addEventListener("click", () => {
        rangeSize = Number(rangeEnd.value || "0");
        pageCount.textContent = "4";
        masterSelect.checked = false;
        updateSelectionLabel();
      });
      masterSelect.addEventListener("click", () => {
        updateSelectionLabel();
      });
      document.getElementById("bulk-save-action").addEventListener("click", () => {
        currentProperty = "bulk-range";
        modal.style.display = "block";
        actionsMenu.style.display = "none";
      });
      document.getElementById("save-confirm").addEventListener("click", () => {
        const saved = JSON.parse(localStorage.getItem("psSaved") || "[]");
        const listInput = document.querySelector("#save-modal input");
        const listName = listInput.value.trim() || document.querySelector("[data-list-option]").textContent.trim();
        if (currentProperty) saved.push({ propertyId: currentProperty, listName, count: rangeSize });
        localStorage.setItem("psSaved", JSON.stringify(saved));
        modal.style.display = "none";
      });
      updateSelectionLabel();
    `,
  );
}

function savedListPageHtml() {
  return html(
    `
      <main>
        <a id="list-link" href="#">Houston - Vacant Absentee</a>
        <div id="toolbar" style="display:none">
          <button id="skip-trace-button" class="skipTraceBtn">Skip Trace</button>
          <button id="skip-trace-start" style="display:none">Start</button>
          <button id="export-button" class="export-button">Export</button>
        </div>
      </main>
    `,
    `
      const toolbar = document.getElementById("toolbar");

      document.getElementById("list-link").addEventListener("click", (event) => {
        event.preventDefault();
        toolbar.style.display = "block";
      });

      document.getElementById("skip-trace-button").addEventListener("click", () => {
        document.getElementById("skip-trace-start").style.display = "inline-block";
      });
      document.getElementById("skip-trace-start").addEventListener("click", () => {
        localStorage.setItem("psSkipTraced", "yes");
      });

      function buildCsv() {
        const skipTraced = localStorage.getItem("psSkipTraced") === "yes";
        return [
          "Address,City,State,Zip,APN,Property Type,Bedrooms,Total Bathrooms,Building Sqft,Lot Size Sqft,Effective Year Built,Total Assessed Value,Last Sale Recording Date,Last Sale Amount,Owner 1 First Name,Owner 1 Last Name,Mailing Address,Mailing City,Mailing State,Mailing Zip,Owner Occupied,Do Not Mail,Phone 1,Phone 1 Type,Phone 1 DNC,Email 1,Litigator,MLS Status,Est. Value,Est. Equity,Est. Loan-to-Value,Foreclosure Factor,Skip Traces",
          [
            "123 Main St","Houston","TX","77084","123-ABC","Single Family Residential","3","2","1450","5400","1988","250000","2020-01-01","200000","Jane","Doe","PO Box 1","Houston","TX","77001","No","Yes",
            skipTraced ? "(555) 111-2222" : "",
            skipTraced ? "Mobile" : "",
            skipTraced ? "No" : "",
            skipTraced ? "jane@example.com" : "",
            "No","EXPIRED","300000","100000","66","Medium", skipTraced ? "1" : "0"
          ].join(",")
        ].join("\\n");
      }

      function triggerDownload() {
        const blob = new Blob([buildCsv()], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "mock-export.csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (target && target.id === "export-button") {
          triggerDownload();
        }
      });
    `,
  );
}

function quotaPageHtml() {
  return html(`
    <main>
      <div>Saves 100 / 50000</div>
      <div>Exports 50 / 50000</div>
      <div>Skip Trace 25 / 50000</div>
      <div>Monitor 10 / 50000</div>
    </main>
  `);
}

function rootPageHtml() {
  return html(`<main><a href="/search">Open Search</a></main>`);
}

function createServers() {
  const receivedEvents: any[] = [];
  const propstreamServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(rootPageHtml());
      return;
    }
    if (url.pathname === "/search" || url.pathname.startsWith("/search/")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(searchPageHtml());
      return;
    }
    if (url.pathname === "/property/group/0") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(savedListPageHtml());
      return;
    }
    if (url.pathname === "/accountnew/landing") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(quotaPageHtml());
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  const hermesServer = http.createServer((req, res) => {
    if (req.method === "POST" && (req.url === "/event" || req.url === "/heartbeat")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        receivedEvents.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "GET" && req.url === "/poll") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("null");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  return { propstreamServer, hermesServer, receivedEvents };
}

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server failed to bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

function buildCommandEnvelope(messageId: string, payload: Record<string, unknown>) {
  return {
    envelope_version: "1.0",
    message_id: messageId,
    timestamp: new Date().toISOString(),
    source: "swarm",
    lane: "houses",
    type: "command",
    correlation_id: null,
    payload,
  };
}

describe("runner integration", () => {
  const servers = createServers();
  let propstreamBaseUrl = "";
  let hermesBaseUrl = "";

  beforeAll(async () => {
    propstreamBaseUrl = await listen(servers.propstreamServer);
    hermesBaseUrl = await listen(servers.hermesServer);
  });

  afterAll(async () => {
    await new Promise((resolve) => servers.propstreamServer.close(resolve));
    await new Promise((resolve) => servers.hermesServer.close(resolve));
  });

  it("runs repeated acquisition cycles against a propstream-like browser target", async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ps-runner-cycle-"));
      const config: RunnerConfig = {
        appRoot: runtimeRoot,
        runtimeRoot,
        artifactsDir: path.join(runtimeRoot, "artifacts"),
        downloadsDir: path.join(runtimeRoot, "downloads"),
        userDataDir: path.join(runtimeRoot, "profile"),
        browserChannel: "chromium",
        allowNativeKeychain: false,
        chromeUserDataDir: path.join(runtimeRoot, "chrome-source"),
        storageStatePath: path.join(runtimeRoot, "storage-state.json"),
        statePath: path.join(runtimeRoot, "state.json"),
        baseUrl: propstreamBaseUrl,
        headless: true,
        pollMode: "short",
        pollIntervalMs: 1000,
        longPollTimeoutMs: 5000,
        heartbeatMs: 60_000,
        operatorTimezone: "America/New_York",
        enableOperatorHours: false,
        operatorHoursStart: 8,
        operatorHoursEnd: 23,
        hermesPollUrl: `${hermesBaseUrl}/poll`,
        hermesEventUrl: `${hermesBaseUrl}/event`,
        hermesHeartbeatUrl: `${hermesBaseUrl}/heartbeat`,
        hermesAuthType: "none",
        hermesAuthHeaderName: "Authorization",
        hermesAuthToken: "",
        hermesAuthPrefix: "Bearer ",
        discordCommandsWebhook: "",
        discordResultsWebhook: "",
        discordQuotaWebhook: "",
        discordAlfredWebhook: "",
        supervisorMode: "rule-based",
        openaiApiKey: "",
        openaiModel: "gpt-5-mini",
        harvestArchiveRoot: path.join(runtimeRoot, "archive"),
        sessionStrategy: "auto",
        cdpPort: 9222,
        cdpAutoLaunch: false,
        sessionRefreshMarginMs: 3_600_000,
        chromeCookiesDbPath: path.join(runtimeRoot, "chrome-source", "Default", "Cookies"),
        cookieStorePath: path.join(runtimeRoot, "cookie-store.json"),
        caseNetBaseUrl: "https://www.courts.mo.gov/cnet",
        courtRecordsArchiveRoot: path.join(runtimeRoot, "court-records"),
        fsboArchiveRoot: path.join(runtimeRoot, "fsbo"),
      };

      const runner = await PropStreamRunner.create(config);
      const startIndex = servers.receivedEvents.length;

      const commands = [
        buildCommandEnvelope(`quota-${cycle}`, { command_type: "QUOTA_CHECK" }),
        buildCommandEnvelope(`search-${cycle}`, {
          command_type: "SEARCH",
          zip: "77084",
          filters: { vacant: true, sfr_detached: true },
          max_results: 2,
        }),
        buildCommandEnvelope(`save-${cycle}`, {
          command_type: "SAVE",
          property_ids: ["prop-1"],
          list_name: "Houston - Vacant Absentee",
        }),
        buildCommandEnvelope(`export-${cycle}`, {
          command_type: "EXPORT",
          list_name: "Houston - Vacant Absentee",
        }),
        buildCommandEnvelope(`skip-${cycle}`, {
          command_type: "SKIP_TRACE",
          property_ids: ["prop-1", "prop-2", "prop-3", "prop-4", "prop-5"],
          list_name: "Houston - Vacant Absentee",
          prefer_batch_route: true,
        }),
      ];

      for (const command of commands) {
        await runner.processEnvelope(command);
      }

      await runner.shutdown();

      const events = servers.receivedEvents.slice(startIndex);
      expect(events).toHaveLength(commands.length);
      const statuses = events.map((e) => e.payload.status);
      expect(statuses.filter((s: string) => s === "success").length).toBeGreaterThanOrEqual(3);

      await rm(runtimeRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("archives a zip harvest through the range-based bulk save flow", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ps-runner-harvest-"));
    const config: RunnerConfig = {
      appRoot: runtimeRoot,
      runtimeRoot,
      artifactsDir: path.join(runtimeRoot, "artifacts"),
      downloadsDir: path.join(runtimeRoot, "downloads"),
      userDataDir: path.join(runtimeRoot, "profile"),
      browserChannel: "chromium",
      allowNativeKeychain: false,
      chromeUserDataDir: path.join(runtimeRoot, "chrome-source"),
      storageStatePath: path.join(runtimeRoot, "storage-state.json"),
      statePath: path.join(runtimeRoot, "state.json"),
      baseUrl: propstreamBaseUrl,
      headless: true,
      pollMode: "short",
      pollIntervalMs: 1000,
      longPollTimeoutMs: 5000,
      heartbeatMs: 60_000,
      operatorTimezone: "America/New_York",
      enableOperatorHours: false,
      operatorHoursStart: 8,
      operatorHoursEnd: 23,
      hermesPollUrl: `${hermesBaseUrl}/poll`,
      hermesEventUrl: `${hermesBaseUrl}/event`,
      hermesHeartbeatUrl: `${hermesBaseUrl}/heartbeat`,
      hermesAuthType: "none",
      hermesAuthHeaderName: "Authorization",
      hermesAuthToken: "",
      hermesAuthPrefix: "Bearer ",
      discordCommandsWebhook: "",
      discordResultsWebhook: "",
      discordQuotaWebhook: "",
      discordAlfredWebhook: "",
      supervisorMode: "rule-based",
      openaiApiKey: "",
      openaiModel: "gpt-5-mini",
      harvestArchiveRoot: path.join(runtimeRoot, "archive"),
      sessionStrategy: "auto",
      cdpPort: 9222,
      cdpAutoLaunch: false,
      sessionRefreshMarginMs: 3_600_000,
      chromeCookiesDbPath: path.join(runtimeRoot, "chrome-source", "Default", "Cookies"),
      cookieStorePath: path.join(runtimeRoot, "cookie-store.json"),
      caseNetBaseUrl: "https://www.courts.mo.gov/cnet",
      courtRecordsArchiveRoot: path.join(runtimeRoot, "court-records"),
      fsboArchiveRoot: path.join(runtimeRoot, "fsbo"),
    };

    const runner = await PropStreamRunner.create(config);
    const result = await runner.harvestZip({
      zip: "77084",
      listName: "Houston - Vacant Absentee",
      maxSkipTraces: 1000,
      maxResults: 2,
    });
    await runner.shutdown();

    expect(result.manifest.counts.discovered).toBeGreaterThan(0);
    expect(result.manifest.counts.saved).toBeGreaterThanOrEqual(0);
    expect(result.manifest.artifacts.pages.length).toBeGreaterThan(0);

    await rm(runtimeRoot, { recursive: true, force: true });
  }, 60_000);
});
