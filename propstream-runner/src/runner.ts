import { BrowserSession } from "./browser/session.js";
import type { RunnerConfig } from "./config.js";
import { buildEnvelope, buildResultPayload, normalizeScope, nowIso, validateCommandEnvelope } from "./protocol.js";
import { BridgeError, QuotaManager } from "./quota.js";
import { redactValue } from "./redaction.js";
import { BoundedSupervisor, RuleBasedSupervisorClient } from "./supervisor/engine.js";
import type { SupervisorClient } from "./supervisor/client.js";
import { OpenAISupervisorClient } from "./supervisor/openai.js";
import { type SupervisorInput } from "./supervisor/schema.js";
import { DiscordMirror } from "./transport/discord.js";
import { HermesTransport } from "./transport/hermes.js";
import type { CommandPayload, Envelope, HarvestPayload, ResultPayload, SearchPayload } from "./types.js";
import { readJsonFile, writeJsonFile } from "./utils/fs.js";
import { PropStreamClient } from "./acquisition/propstream-client.js";
import { ArchiveStore, type HarvestQuery } from "./archive.js";

type PersistedState = ReturnType<QuotaManager["serialize"]> & {
  lastSuccessfulCommandAt: string | null;
  processedCommandIds: string[];
};

type CommandExecutionResult = {
  status: "success" | "partial" | "failure";
  items: Array<Record<string, unknown>>;
  errors: ResultPayload["errors"];
};

export class PropStreamRunner {
  private readonly hermes: HermesTransport;
  private readonly discord: DiscordMirror;
  private readonly browser: BrowserSession;
  private readonly quota: QuotaManager;
  private readonly supervisor: BoundedSupervisor;
  private readonly propstream: PropStreamClient;
  private readonly archive: ArchiveStore;
  private readonly processedCommandIds = new Set<string>();
  private lastSuccessfulCommandAt: string | null;
  private queueDepth = 0;

  private constructor(
    private readonly config: RunnerConfig,
    persisted: PersistedState,
    supervisorClient: SupervisorClient,
  ) {
    this.hermes = new HermesTransport(config);
    this.discord = new DiscordMirror({
      commands: config.discordCommandsWebhook,
      results: config.discordResultsWebhook,
      quota: config.discordQuotaWebhook,
      alfred: config.discordAlfredWebhook,
    });
    this.browser = new BrowserSession(config);
    this.quota = new QuotaManager(persisted);
    this.supervisor = new BoundedSupervisor(supervisorClient);
    this.propstream = new PropStreamClient(this.browser, config, this.quota);
    this.archive = new ArchiveStore(config.harvestArchiveRoot);
    this.lastSuccessfulCommandAt = persisted.lastSuccessfulCommandAt ?? null;
    for (const id of persisted.processedCommandIds ?? []) {
      this.processedCommandIds.add(id);
    }
  }

  static async create(config: RunnerConfig) {
    const persisted = await readJsonFile<PersistedState>(config.statePath, {
      counters: {
        saves: 0,
        exports: 0,
        skip_trace: 0,
        monitor: 0,
        remoteRemaining: {},
        reconciledAt: null,
        operationsSinceQuotaCheck: 0,
      },
      thresholdState: {},
      haltedScopes: [],
      masterHalt: false,
      lastSuccessfulCommandAt: null,
      processedCommandIds: [],
    });

    const supervisorClient =
      config.supervisorMode === "openai"
        ? new OpenAISupervisorClient(config)
        : new RuleBasedSupervisorClient();

    const runner = new PropStreamRunner(config, persisted, supervisorClient);
    await runner.browser.start();
    await runner.browser.armTracing();
    return runner;
  }

  async bootstrapAuth() {
    return this.browser.bootstrapAuth();
  }

  async waitForManualSearchReady() {
    return this.browser.waitForManualSearchReady();
  }

  async harvestZipInLiveSession(query: HarvestQuery) {
    const run = await this.archive.startRun(query);
    await this.propstream.openSearch();
    const searchItems = await this.propstream.searchInLiveSession({
      command_type: "SEARCH",
      zip: query.zip,
      filters: query.filters,
      max_results: query.maxResults ?? 250,
    });
    const pageState = await this.propstream.currentPageState().catch(() => null);
    const discoveredCount = this.extractCount(pageState?.result_count_text) ?? searchItems.items.length;
    const targetCount = Math.min(
      query.maxSkipTraces ?? query.maxResults ?? discoveredCount,
      discoveredCount,
    );
    run.manifest.counts.discovered = discoveredCount;
    const pageFile = await this.archive.archiveSearchPage(run.runDir, 1, searchItems.items);
    run.manifest.artifacts.pages.push(pageFile);

    if (targetCount > 0) {
      let savedCount = 0;
      try {
        savedCount = await this.propstream.saveSearchRangeToList({
          listName: query.listName,
          startIndex: 1,
          endIndex: targetCount,
        });
      } catch (error) {
        console.error(
          `[propstream] harvest:range-save-fallback ${JSON.stringify({
            code: (error as { code?: string })?.code || "UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
        const fallbackSaveIds = searchItems.items
          .slice(0, targetCount)
          .map((item) => String(item.route_hint || item.property_id || item.summary || ""))
          .filter(Boolean);
        const fallbackSave = await this.propstream.save({
          command_type: "SAVE",
          property_ids: fallbackSaveIds,
          list_name: query.listName,
        });
        savedCount = fallbackSave.items.length;
      }
      run.manifest.counts.saved = savedCount;

      const propertyIds = Array.from({ length: targetCount }, (_, index) => `range-${index + 1}`);
      let skipResult;
      try {
        skipResult = await this.propstream.skipTrace({
          command_type: "SKIP_TRACE",
          property_ids: propertyIds,
          list_name: query.listName,
          prefer_batch_route: true,
        });
      } catch (error) {
        console.error(
          `[propstream] harvest:skip-trace-fallback ${JSON.stringify({
            code: (error as { code?: string })?.code || "UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
        const fallbackSkipIds = searchItems.items
          .slice(0, targetCount)
          .map((item) => String(item.summary || item.route_hint || item.property_id || ""))
          .filter(Boolean);
        skipResult = await this.propstream.skipTrace({
          command_type: "SKIP_TRACE",
          property_ids: fallbackSkipIds,
          list_name: query.listName,
          prefer_batch_route: false,
        });
      }
      const exportRows = skipResult.items as Array<Record<string, unknown>>;
      run.manifest.counts.skipTraced = propertyIds.length;
      run.manifest.counts.exported = exportRows.length;

      const exportFile = await this.archive.archiveExportRows(
        run.runDir,
        query.listName,
        exportRows as Array<Record<string, unknown> & { property_id: string }>,
      );
      run.manifest.artifacts.rawExports.push(exportFile);

      const archived = await this.archive.archivePropertyRecords(
        query.listName,
        exportRows as Array<Record<string, unknown> & { property_id: string }>,
      );
      run.manifest.counts.archivedProperties = archived.propertyCount;
      run.manifest.counts.archivedContacts = archived.contactCount;
    }

    run.manifest.completedAt = nowIso();
    await this.archive.updateManifest(run.runDir, run.manifest);
    return run.manifest;
  }

  async harvestMultiDistress(baseQuery: HarvestQuery, distressSignals: string[]) {
    const results: Array<{ signal: string; manifest: Record<string, unknown> }> = [];
    for (const signal of distressSignals) {
      const signalListName = `${baseQuery.listName}-${signal}`;
      const signalFilters = { ...baseQuery.filters, [signal]: true };
      console.log(`\n[propstream] === DISTRESS SIGNAL: ${signal} ===`);
      console.log(`[propstream] list: ${signalListName}, filters: ${JSON.stringify(signalFilters)}`);
      try {
        const manifest = await this.harvestZipInLiveSession({
          ...baseQuery,
          listName: signalListName,
          filters: signalFilters,
        });
        results.push({ signal, manifest: manifest as any });
        console.log(`[propstream] ${signal} complete: discovered=${manifest.counts.discovered} saved=${manifest.counts.saved} exported=${manifest.counts.exported}`);
      } catch (error) {
        console.error(`[propstream] ${signal} FAILED: ${error instanceof Error ? error.message : String(error)}`);
        results.push({ signal, manifest: { error: error instanceof Error ? error.message : String(error) } as any });
      }
    }
    return results;
  }

  async exportListCsv(listName: string, saveTo: string) {
    return this.propstream.exportListCsv(listName, saveTo);
  }

  async scoutCounty(searchTerm: string, signals?: string[]) {
    return this.propstream.scoutCounty(searchTerm, signals);
  }

  async searchAndSaveAll(searchTerm: string, filters: Record<string, unknown>, listName: string, maxCount: number) {
    await this.propstream.openSearch();
    const searchResult = await this.propstream.searchInLiveSession({
      command_type: "SEARCH",
      zip: searchTerm,
      filters,
      max_results: 50,
    });
    const pageState = await this.propstream.currentPageState().catch(() => null);
    const discoveredCount = this.extractCount(pageState?.result_count_text) ?? searchResult.items.length;
    const targetCount = Math.min(maxCount, discoveredCount);
    console.log(`[lead-harvest] Discovered ${discoveredCount} results, targeting ${targetCount}`);

    if (targetCount <= 0) return { discovered: discoveredCount, saved: 0 };

    let savedCount = 0;
    try {
      savedCount = await this.propstream.saveAllViaApi({ listName, totalCount: targetCount });
      console.log(`[lead-harvest] Saved ${savedCount} via API`);
    } catch (error) {
      console.error(`[lead-harvest] API save failed, falling back to visible: ${(error as Error).message}`);
      const page = await this.browser.getPage();
      await this.propstream.saveSearchRangeToList({ listName, startIndex: 1, endIndex: Math.min(targetCount, 50) });
      savedCount = Math.min(targetCount, 50);
    }
    return { discovered: discoveredCount, saved: savedCount };
  }

  async skipTraceList(listName: string, count = 9999) {
    const propertyIds = Array.from({ length: count }, (_, i) => `range-${i + 1}`);
    return this.propstream.skipTrace({
      command_type: "SKIP_TRACE",
      property_ids: propertyIds,
      list_name: listName,
      prefer_batch_route: true,
    });
  }

  async skipTraceOrderOnly(listName: string, count = 9999) {
    return this.propstream.skipTraceOrderOnly(listName, count);
  }

  async exportListWithPhoneCheck(listName: string, saveTo: string, maxAttempts = 6): Promise<{ rows: number; path: string; hasPhones: boolean }> {
    const { writeFile } = await import("node:fs/promises");
    let consecutiveNoPhone = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const waitSec = attempt === 1 ? 0 : Math.min(60, 15 * attempt);
      if (waitSec > 0) {
        console.log(`[skip-trace] Attempt ${attempt}/${maxAttempts} — waiting ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
      try {
        const result = await this.propstream.exportList({
          command_type: "EXPORT",
          list_name: listName,
        });
        const hasPhones = result.items.some(
          (item: Record<string, unknown>) => {
            for (const phones of (item as any).phone_numbers || []) {
              if (typeof phones === "object" && phones?.value) return true;
              if (typeof phones === "string" && phones.length >= 10) return true;
            }
            return false;
          },
        );
        const csv = this.lastExportCsv;
        if (csv) {
          await writeFile(saveTo, csv, "utf8");
        }
        if (hasPhones) {
          console.log(`[skip-trace] Phone data found on attempt ${attempt} — ${result.items.length} rows exported`);
          return { rows: result.items.length, path: saveTo, hasPhones: true };
        }
        consecutiveNoPhone++;
        console.log(`[skip-trace] Attempt ${attempt}: ${result.items.length} rows, no phones (${consecutiveNoPhone} consecutive)`);
        if (consecutiveNoPhone >= 3 && attempt >= 3) {
          console.log(`[skip-trace] Aborting — 3 consecutive exports without phone data`);
          break;
        }
      } catch (error) {
        console.log(`[skip-trace] Attempt ${attempt} export failed: ${error instanceof Error ? error.message : String(error)}`);
        consecutiveNoPhone = 0;
      }
    }
    console.log(`[skip-trace] WARNING: No phone data found after polling — export may need manual retry`);
    return { rows: 0, path: saveTo, hasPhones: false };
  }

  async importCsvToList(csvPath: string, listName: string) {
    return this.propstream.importCsvToList({ csvPath, listName });
  }

  get lastExportCsv() { return this.propstream.lastExportCsv; }

  async checkSkipTraceBalance(): Promise<{ skip_trace: number | null; saves: number | null; exports: number | null }> {
    try {
      const result = await this.propstream.quotaCheck();
      const counters = result.items[0] as Record<string, number | null> | undefined;
      return {
        skip_trace: counters?.skip_trace ?? null,
        saves: counters?.saves ?? null,
        exports: counters?.exports ?? null,
      };
    } catch {
      return { skip_trace: null, saves: null, exports: null };
    }
  }

  async interactiveSearch(command: SearchPayload) {
    return this.propstream.search(command);
  }

  async interactivePageState() {
    return this.propstream.currentPageState();
  }

  private extractCount(text: string | null | undefined) {
    const match = String(text || "").match(/(\d[\d,]*)/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  async harvestZip(query: HarvestQuery) {
    const run = await this.archive.startRun(query);
    let harvestedRows: Array<Record<string, unknown>> = [];

    await this.executeCommand(
      { command_type: "QUOTA_CHECK" },
      `harvest-quota-${run.runId}`,
    ).catch((error) => {
      console.error(
        `[propstream] harvest:quota-check-skipped ${JSON.stringify({
          stage: "pre-search",
          code: (error as { code?: string })?.code || "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        })}`,
      );
    });

    const searchItems = await this.propstream.search({
      command_type: "SEARCH",
      zip: query.zip,
      filters: query.filters,
      max_results: query.maxResults ?? 250,
    });
    const pageState = await this.propstream.currentPageState().catch(() => null);
    const discoveredCount = this.extractCount(pageState?.result_count_text) ?? searchItems.items.length;
    const targetCount = Math.min(
      query.maxSkipTraces ?? query.maxResults ?? discoveredCount,
      discoveredCount,
    );
    run.manifest.counts.discovered = discoveredCount;
    const pageFile = await this.archive.archiveSearchPage(run.runDir, 1, searchItems.items);
    run.manifest.artifacts.pages.push(pageFile);

    if (targetCount > 0) {
      const savedCount = await this.propstream.saveSearchRangeToList({
        listName: query.listName,
        startIndex: 1,
        endIndex: targetCount,
      });
      run.manifest.counts.saved = savedCount;

      const propertyIds = Array.from({ length: targetCount }, (_, index) => `range-${index + 1}`);
      let skipResult;
      try {
        skipResult = await this.propstream.skipTrace({
          command_type: "SKIP_TRACE",
          property_ids: propertyIds,
          list_name: query.listName,
          prefer_batch_route: true,
        });
      } catch (error) {
        console.error(
          `[propstream] harvest:skip-trace-fallback ${JSON.stringify({
            code: (error as { code?: string })?.code || "UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
        const fallbackSkipIds = searchItems.items
          .slice(0, targetCount)
          .map((item) => String(item.summary || item.route_hint || item.property_id || ""))
          .filter(Boolean);
        skipResult = await this.propstream.skipTrace({
          command_type: "SKIP_TRACE",
          property_ids: fallbackSkipIds,
          list_name: query.listName,
          prefer_batch_route: false,
        });
      }
      const exportRows = skipResult.items as Array<Record<string, unknown>>;
      harvestedRows = exportRows;
      run.manifest.counts.skipTraced = propertyIds.length;
      run.manifest.counts.exported = exportRows.length;

      const exportFile = await this.archive.archiveExportRows(
        run.runDir,
        query.listName,
        exportRows as Array<Record<string, unknown> & { property_id: string }>,
      );
      run.manifest.artifacts.rawExports.push(exportFile);

      const archived = await this.archive.archivePropertyRecords(
        query.listName,
        exportRows as Array<Record<string, unknown> & { property_id: string }>,
      );
      run.manifest.counts.archivedProperties = archived.propertyCount;
      run.manifest.counts.archivedContacts = archived.contactCount;
    }

    run.manifest.completedAt = nowIso();
    await this.archive.updateManifest(run.runDir, run.manifest);
    return { manifest: run.manifest, exportRows: harvestedRows };
  }

  private async persistState() {
    await writeJsonFile(this.config.statePath, {
      ...this.quota.serialize(),
      lastSuccessfulCommandAt: this.lastSuccessfulCommandAt,
      processedCommandIds: Array.from(this.processedCommandIds).slice(-500),
    });
  }

  private isWithinOperatorWindow() {
    if (!this.config.enableOperatorHours) return true;
    const local = new Date(
      new Date().toLocaleString("en-US", { timeZone: this.config.operatorTimezone }),
    );
    const hour = local.getHours();
    return hour >= this.config.operatorHoursStart && hour < this.config.operatorHoursEnd;
  }

  async run() {
    const heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => undefined);
    }, this.config.heartbeatMs);

    try {
      while (true) {
        await this.pollOnce();
        if (this.config.pollMode === "short") {
          await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
        }
      }
    } finally {
      clearInterval(heartbeatTimer);
      await this.browser.close();
    }
  }

  private async pollOnce() {
    const raw = await this.hermes.poll();
    if (!raw) return;
    const envelopes = Array.isArray(raw) ? raw : [raw];
    this.queueDepth = envelopes.length;
    for (const envelope of envelopes) {
      await this.processEnvelope(envelope);
    }
  }

  async processEnvelope(raw: unknown) {
    let envelope: Envelope<CommandPayload>;
    try {
      envelope = validateCommandEnvelope(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Envelope validation failed";
      await this.emitError(null, "PING", "INVALID_COMMAND", message, true);
      return;
    }

    if (this.processedCommandIds.has(envelope.message_id)) {
      return;
    }

    await this.discord.mirrorCommand(envelope).catch(() => undefined);

    if (!this.isWithinOperatorWindow() && !["HALT", "RESUME", "PING", "QUOTA_CHECK"].includes(envelope.payload.command_type)) {
      await this.emitError(
        envelope.message_id,
        envelope.payload.command_type,
        "OUTSIDE_OPERATOR_WINDOW",
        "Command refused outside the configured operator window",
      );
      return;
    }

    try {
      const result = await this.executeCommand(envelope.payload, envelope.message_id);
      this.lastSuccessfulCommandAt = nowIso();
      await this.postSuccessEnvelope(envelope.payload.command_type, envelope.message_id, result);
      this.processedCommandIds.add(envelope.message_id);
      await this.persistState();
    } catch (error) {
      const typed = error as BridgeError;
      const fallbackRecommended =
        typed.code === "CAPTCHA_REQUIRED" ||
        typed.code === "AUTH_REQUIRED" ||
        typed.code === "DOM_SELECTOR_MISSING";
      const recovered = await this.tryRecovery(envelope.payload, typed, envelope.message_id);
      if (recovered) {
        this.lastSuccessfulCommandAt = nowIso();
        await this.postSuccessEnvelope(envelope.payload.command_type, envelope.message_id, recovered);
        this.processedCommandIds.add(envelope.message_id);
        await this.persistState();
        return;
      }
      await this.emitError(
        envelope.message_id,
        envelope.payload.command_type,
        typed.code || "UNKNOWN",
        typed.message || "Unknown error",
        fallbackRecommended,
        false,
      );
      await this.persistState();
    }
  }

  private async postSuccessEnvelope(
    commandType: CommandPayload["command_type"],
    correlationId: string,
    result: ResultPayload,
  ) {
    const outgoing = buildEnvelope(
      commandType === "PING" ? "heartbeat" : "result",
      result,
      { correlationId },
    );
    await this.hermes.postEnvelope(
      outgoing as Envelope<object>,
      commandType === "PING" ? "heartbeat" : "event",
    );
    await this.discord.mirrorResult(outgoing as Envelope<object>).catch(() => undefined);
  }

  private async executeCommand(
    command: CommandPayload,
    correlationId: string,
  ): Promise<ResultPayload> {
    void correlationId;
    let result: CommandExecutionResult;

    switch (command.command_type) {
      case "SEARCH":
        result = await this.propstream.search(command);
        break;
      case "SAVE":
        this.quota.guardCostBearingCommand("saves", command.property_ids.length || 1);
        result = await this.propstream.save(command);
        break;
      case "EXPORT":
        this.quota.guardCostBearingCommand("exports", 1);
        result = await this.propstream.exportList(command);
        break;
      case "SKIP_TRACE":
        this.quota.guardCostBearingCommand("skip_trace", command.property_ids.length || 1);
        result = await this.propstream.skipTrace(command);
        break;
      case "HARVEST": {
        const harvestCmd = command as HarvestPayload;
        const harvest = await this.harvestZip({
          zip: harvestCmd.zip,
          listName: harvestCmd.list_name,
          maxResults: harvestCmd.max_results ?? 250,
          maxSkipTraces: harvestCmd.max_skip_traces,
          filters: harvestCmd.filters,
        });
        result = {
          status: harvest.manifest.completedAt ? "success" : "failure",
          items: [{
            run_id: harvest.manifest.runId,
            zip: harvestCmd.zip,
            list_name: harvestCmd.list_name,
            discovered: harvest.manifest.counts.discovered,
            saved: harvest.manifest.counts.saved,
            skip_traced: harvest.manifest.counts.skipTraced,
            exported: harvest.manifest.counts.exported,
            archived_properties: harvest.manifest.counts.archivedProperties,
            archived_contacts: harvest.manifest.counts.archivedContacts,
            export_rows: harvest.exportRows,
          }],
          errors: [],
        };
        break;
      }
      case "QUOTA_CHECK":
        result = await this.propstream.quotaCheck();
        break;
      case "HALT": {
        this.quota.haltScope(command.scope || "all");
        result = { status: "success", items: [{ scope: normalizeScope(command.scope || "all"), halted: true }], errors: [] };
        break;
      }
      case "RESUME": {
        this.quota.resumeScope(command.scope || "all");
        result = { status: "success", items: [{ scope: normalizeScope(command.scope || "all"), halted: false }], errors: [] };
        break;
      }
      case "PING":
        result = {
          status: "success",
          items: [
            {
              script_version: "0.1.0",
              uptime_seconds: 0,
              last_successful_command_at: this.lastSuccessfulCommandAt,
              queue_depth: this.queueDepth,
              master_halt: this.quota.masterHalt,
              halted_scopes: Array.from(this.quota.haltedScopes),
            },
          ],
          errors: [],
        };
        break;
      default:
        throw new BridgeError("INVALID_COMMAND", `Unsupported command ${JSON.stringify(command)}`);
    }

    return buildResultPayload(
      command.command_type,
      this.quota.snapshot(),
      result.items,
      result.errors,
      {
        runtime: "playwright-runner",
        execution_mode: this.browser.executionMode(),
        recovery_used: false,
        fallback_recommended: false,
        auth_status: "ok",
      },
      result.status,
    ) as ResultPayload;
  }

  private canRetryAfterRecovery(command: CommandPayload, error: BridgeError) {
    if (command.command_type === "SEARCH" || command.command_type === "QUOTA_CHECK" || command.command_type === "HARVEST") return true;
    if (!["SAVE", "EXPORT", "SKIP_TRACE"].includes(command.command_type)) return false;
    if (error.code !== "DOM_SELECTOR_MISSING") return false;
    return !/(clicked|started|finished)/i.test(this.propstream.getLastSuccessfulStep());
  }

  private async tryRecovery(
    command: CommandPayload,
    error: BridgeError,
    correlationId: string,
  ): Promise<ResultPayload | null> {
    if (!["DOM_SELECTOR_MISSING", "ACTION_NOT_CONFIRMED", "AUTH_REQUIRED", "CAPTCHA_REQUIRED"].includes(error.code)) {
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pageState = await this.propstream.currentPageState().catch(() => null);
      if (!pageState) break;
      const input: SupervisorInput = {
        objective: `Recover ${command.command_type} flow`,
        current_command: redactValue(command),
        current_route: pageState.route,
        current_page_phase: pageState.page_phase,
        last_successful_step: this.propstream.getLastSuccessfulStep(),
        contradictions: [error.message],
        available_actions: [
          "refresh_current_page",
          "reopen_search_page",
          "reopen_filters_panel",
          "retry_alternate_selector_family",
          "reopen_property_detail_panel",
          "reopen_saved_list_page",
          "wait_for_route_stabilization",
          "capture_trace_and_escalate",
          "switch_to_fallback_userscript",
        ],
        page_state: pageState,
      };
      const decision = await this.supervisor.decide(input).catch(() => null);
      if (!decision) break;
      await this.propstream.dispatchRecoveryAction(decision.next_action);
      if (decision.stop_and_escalate) {
        return null;
      }
      try {
        await this.propstream.ensureReady();
        if (!this.canRetryAfterRecovery(command, error)) {
          return null;
        }
        const rerun = await this.executeCommand(command, correlationId);
        return {
          ...rerun,
          recovery_used: true,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  private async emitError(
    correlationId: string | null,
    commandType: string,
    code: string,
    message: string,
    fallbackRecommended = false,
    recoveryUsed = false,
  ) {
    const pageState = await this.propstream.currentPageState().catch(() => null);
    const payload = buildResultPayload(
      commandType as ResultPayload["command_type"],
      this.quota.snapshot(),
      [],
      [{ code, message }],
      {
        runtime: "playwright-runner",
        execution_mode: this.browser.executionMode(),
        recovery_used: recoveryUsed,
        fallback_recommended: fallbackRecommended,
        auth_status:
          code === "AUTH_REQUIRED"
            ? "reauth_required"
            : code === "CAPTCHA_REQUIRED"
              ? "captcha_required"
              : "ok",
      },
      "failure",
    ) as ResultPayload;
    const envelope = buildEnvelope("error", {
      ...payload,
      page_state: pageState ? redactValue(pageState) : undefined,
    }, { correlationId });
    await this.hermes.postEnvelope(envelope as Envelope<object>);
    await this.discord.mirrorResult(envelope as Envelope<object>).catch(() => undefined);
    if (fallbackRecommended) {
      await this.discord.postAlfredAlert(`:rotating_light: ${code} during ${commandType}. Fallback recommended.`);
    }
  }

  private async sendHeartbeat() {
    const payload = buildResultPayload(
      "HEARTBEAT",
      this.quota.snapshot(),
      [
        {
          script_version: "0.1.0",
          uptime_seconds: 0,
          last_successful_command_at: this.lastSuccessfulCommandAt,
          queue_depth: this.queueDepth,
          master_halt: this.quota.masterHalt,
          halted_scopes: Array.from(this.quota.haltedScopes),
        },
      ],
      [],
      {
        runtime: "playwright-runner",
        execution_mode: this.browser.executionMode(),
        recovery_used: false,
        fallback_recommended: false,
        auth_status: "ok",
      },
      "success",
    );
    const envelope = buildEnvelope("heartbeat", payload, { correlationId: null });
    await this.hermes.postEnvelope(envelope as Envelope<object>, "heartbeat").catch(() => undefined);
  }

  async shutdown() {
    await this.persistState();
    await this.browser.close();
  }
}
