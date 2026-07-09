import type { Lead, PhoneRecord, PipelineStats, SourceAdapter, KpiSummary, FollowUp, MarketInfo, SocialComment, SocialCampaign, SocialBanditStats, FoiaRequest, WaterShutoffRecord, WaterShutoffStats, FsboListing, FsboMarket, FsboStats, FsboScrapeStatus, CourtRecordCounty, CourtRecordCase, CourtRecordStats, CourtRecordScrapeStatus, CountyScouting, CountyScoutingStats, ScoutPipelineStatus, DistressedProperty, CallRecording, CallRecordingStats, UnderwritingReport, EvaluationStatus, ConversionFunnel, CallMetrics, DailyActivity, SourceRoi, TrackerKpis, DialStreak, AgentDefinition, AgentRun, Proposal, AgentProxyStatus, Contract, ContractData, UserSettings, CallerAvailability, Expense, Revenue, PayrollEntry, FinanceSummary, CallerDailyLog, CallerActivity, ActivityDaySummary, IntegrityReport, Conversation, ConversationMessage, ChatResponse } from './types'

const BASE = '/api'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('swarm_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() })
  if (res.status === 401) {
    localStorage.removeItem('swarm_token')
    window.location.reload()
  }
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    localStorage.removeItem('swarm_token')
    window.location.reload()
  }
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback
  if (typeof val !== 'string') return val as T
  try { return JSON.parse(val) } catch { return fallback }
}

function normalizeLead(raw: any): Lead {
  const distress_signals = parseJsonField<string[]>(raw.distress_signals_json, [])

  let phones: PhoneRecord[] = raw.phone_numbers || []
  if (phones.length === 0 && raw.phones_json) {
    phones = parseJsonField<PhoneRecord[]>(raw.phones_json, [])
  }

  const callable_phones = phones.filter(
    (p) => (p.phone_type?.toLowerCase() === 'cell' || p.phone_type?.toLowerCase() === 'mobile')
      && !(p as any).bad_number
  )

  return {
    ...raw,
    distress_signals,
    callable_phones,
    phone_numbers: phones,
  }
}

export const hermesClient = {
  leads: {
    list: async (params?: { status?: string; exclude_statuses?: string; tier?: string; source?: string; persona?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      const raw = await get<any[]>(`/leads${query ? `?${query}` : ''}`)
      return raw.map(normalizeLead) as Lead[]
    },
    get: async (id: string) => {
      const raw = await get<any>(`/leads/${id}`)
      return normalizeLead(raw) as Lead
    },
    assignments: {
      stats: () => get<Array<{ user_id: number; caller_name: string; total_assigned: number; remaining: number; contacted: number; interested: number; not_interested: number; follow_up: number; assigned_since: string | null }>>('/leads/assignments'),
      autoAssign: (callerIds: number[], countPerCaller?: number) =>
        post<{ status: string; assigned: Record<number, number>; total: number }>('/leads/assignments/auto', { caller_ids: callerIds, count_per_caller: countPerCaller }),
      compare: (callerIds: number[]) =>
        get<Record<number, any>>(`/leads/assignments/compare?caller_ids=${callerIds.join(',')}`),
    },
    updateStatus: (id: string, status: string, reason?: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/status`, { status, reason }),
    addNote: (id: string, note_type: string, content: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/notes`, { note_type, content }),
    archive: (id: string, reason?: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/status`, { status: 'archived', reason: reason || 'Bad number' }),
    bulkUpdateStatus: (leadIds: string[], status: string, reason?: string) =>
      post<{ status: string; updated: number; errors?: string[] }>('/leads/bulk-status', { lead_ids: leadIds, status, reason }),
    logCall: (id: string, disposition: string, notes?: string, phone_number?: string) =>
      post<{ status: string; disposition: string; called_at: string; phone_number?: string }>(`/leads/${id}/calls`, { disposition, notes, phone_number }),
    callHistory: (id: string) =>
      get<Array<{ id: number; lead_id: string; disposition: string; notes: string | null; called_at: string; phone_number: string | null }>>(`/leads/${id}/calls`),
    lookupByPhone: async (phone: string): Promise<Lead | null> => {
      try {
        const raw = await get<any>(`/leads/lookup-by-phone?phone=${encodeURIComponent(phone)}`)
        return raw ? normalizeLead(raw) : null
      } catch { return null }
    },
  },

  pipeline: {
    stats: () => get<PipelineStats>('/pipeline/stats'),
    run: (params?: { harvest_dir?: string; top_n?: number }) =>
      post<{ status: string; stdout?: string; stderr?: string; csv_path?: string }>('/pipeline/run', params),
  },

  queue: {
    hot: async () => {
      const raw = await get<any[]>('/queue/hot')
      return raw.map(normalizeLead) as Lead[]
    },
    all: async () => {
      const raw = await get<any[]>('/queue/all')
      return raw.map(normalizeLead) as Lead[]
    },
  },

  sources: {
    list: () => get<SourceAdapter[]>('/sources'),
    run: (sourceId: string, params?: Record<string, unknown>) =>
      post<{ status: string }>(`/sources/${sourceId}/run`, params),
    scrapeZillowFsbo: (params?: { markets?: string[]; max_pages?: number }) =>
      post<{ status: string; markets: string[] }>('/sources/zillow_fsbo/scrape', params),
    zillowFsboStatus: () =>
      get<{ running: boolean; log: string[]; markets: string[]; result?: any; error?: string }>('/sources/zillow_fsbo/status'),
    scrapeCodeViolations: (params?: { portal_ids?: string[]; days_back?: number; limit?: number }) =>
      post<{ status: string; portals_scraped: number; total_leads: number; details: any[] }>(
        '/sources/code_violations/scrape', params,
      ),
  },

  skipTrace: {
    queue: (params?: { lead_ids?: string[]; source?: string; limit?: number }) =>
      post<{ status: string; queued: number; command_id?: string }>('/skip-trace/queue', params),
    exportForPropstream: (params?: { source?: string; limit?: number }) =>
      post<{ status: string; count: number; csv_path?: string; message?: string }>('/skip-trace/export-for-propstream', params),
    ingestCsvs: () =>
      post<{ status: string; files_processed: number; total_rows_parsed: number; code_violation_leads_with_phones: number }>('/skip-trace/ingest-csv', {}),
    runPipeline: (params?: { source?: string }) =>
      post<{ status: string; job_id?: string; address_count?: number; message?: string }>('/skip-trace/run-pipeline', params),
    pipelineStatus: () =>
      get<{
        running: boolean; job_id: string | null; phase: string;
        log_lines: string[]; started_at: string | null; completed_at: string | null;
        result: Record<string, unknown> | null; error: string | null; address_count: number;
      }>('/skip-trace/pipeline-status'),
  },

  commandQueue: {
    status: () => get<{ total: number; pending: number; delivered: number; by_type: Record<string, { total: number; pending: number }> }>('/command-queue/status'),
  },

  quota: () => get<Record<string, number>>('/quota'),

  evaluation: {
    run: () => post<{ status: string }>('/evaluation/run'),
    status: () => get<EvaluationStatus>('/evaluation/status'),
  },

  underwriting: {
    report: (leadId: string) => get<UnderwritingReport>(`/underwriting/report/${leadId}`),
    reports: (status?: string) => {
      const qs = status ? `?status=${status}` : ''
      return get<UnderwritingReport[]>(`/underwriting/reports${qs}`)
    },
    run: (leadId: string) => post<{ status: string; lead_id: string }>(`/underwriting/run/${leadId}`),
    refresh: (leadId: string) => post<{ status: string; lead_id: string }>(`/underwriting/refresh/${leadId}`),
  },

  kpi: {
    summary: () => get<KpiSummary>('/kpi/summary'),
    funnel: (days = 30) => get<ConversionFunnel>(`/kpi/funnel?days=${days}`),
    calls: (days = 7) => get<CallMetrics>(`/kpi/calls?days=${days}`),
    daily: (days = 30) => get<DailyActivity[]>(`/kpi/daily?days=${days}`),
    sourceRoi: () => get<SourceRoi[]>('/kpi/source-roi'),
    tracker: () => get<TrackerKpis>('/kpi/tracker'),
    dialStreak: () => get<DialStreak>('/kpi/dial-streak'),
  },

  markets: {
    list: () => get<{ status: string; markets: MarketInfo[] }>('/markets'),
  },

  pendingVerification: {
    stats: () => get<{ total_pending: number; by_source: Record<string, Record<string, number>>; items: any[] }>('/pending-verification'),
    verifyAll: () => post<{ status: string; job_id?: string; address_count?: number; message?: string }>('/verify-batch', {}),
  },

  jobs: {
    list: () => get<any[]>('/jobs'),
    get: (jobId: string) => get<any>(`/jobs/${jobId}`),
  },

  followUps: {
    list: () => get<FollowUp[]>('/follow-ups'),
    create: (leadId: string, type: string, scheduledAt: string, notes?: string) =>
      post<{ status: string; id: number }>('/follow-ups', { lead_id: leadId, follow_up_type: type, scheduled_at: scheduledAt, notes }),
    complete: (id: number, outcome: string) =>
      post<{ status: string; id: number }>(`/follow-ups/${id}/complete`, { outcome }),
  },

  socialBandit: {
    stats: () => get<SocialBanditStats>('/social-bandit/stats'),

    campaigns: {
      list: () => get<SocialCampaign[]>('/social-bandit/campaigns'),
      create: (data: { platform: string; campaign_name: string; post_url: string; post_type: string; target_market: string }) =>
        post<{ status: string; id: number }>('/social-bandit/campaigns', data),
      scrape: (campaignId: number) =>
        post<{ status: string; new_comments: number; campaign_id: number }>(`/social-bandit/campaigns/${campaignId}/scrape`),
      toggle: (campaignId: number, active: boolean) =>
        post<{ status: string }>(`/social-bandit/campaigns/${campaignId}/toggle`, { active }),
    },

    comments: {
      list: (params?: { status?: string; campaign_id?: number; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) qs.set(k, String(v))
          }
        }
        const query = qs.toString()
        return get<SocialComment[]>(`/social-bandit/comments${query ? `?${query}` : ''}`)
      },
      classify: (commentId: number, status: string, notes?: string) =>
        post<{ status: string }>(`/social-bandit/comments/${commentId}/classify`, { status, notes }),
      extract: (commentId: number, extracted: { name?: string; phone?: string; address?: string; city?: string; state?: string }) =>
        post<{ status: string }>(`/social-bandit/comments/${commentId}/extract`, extracted),
      ingest: (commentIds: number[]) =>
        post<{ status: string; ingested: number; leads_created: number }>('/social-bandit/comments/ingest', { comment_ids: commentIds }),
      bulkClassify: (commentIds: number[], status: string) =>
        post<{ status: string; updated: number }>('/social-bandit/comments/bulk-classify', { comment_ids: commentIds, status }),
    },

    importComments: (data: { platform: string; post_url: string; post_type: string; target_market: string; comments: { commenter_name: string; comment_text: string; commenter_profile_url?: string; comment_date?: string }[] }) =>
      post<{ status: string; imported: number; campaign_id: number }>('/social-bandit/import', data),
  },

  waterShutoffs: {
    stats: () => get<WaterShutoffStats>('/water-shutoffs/stats'),

    requests: {
      list: () => get<FoiaRequest[]>('/water-shutoffs/requests'),
      create: (data: { city: string; state: string; agency_name: string; agency_contact?: string; submission_method?: string; notes?: string }) =>
        post<{ status: string; id: number }>('/water-shutoffs/requests', data),
      update: (id: number, updates: Record<string, unknown>) =>
        post<{ status: string; id: number }>(`/water-shutoffs/requests/${id}`, updates),
      letter: (id: number) =>
        post<{ status: string; letter: string; legal_basis: string; request_id: number }>(`/water-shutoffs/requests/${id}/letter`),
    },

    records: {
      list: (params?: { foia_request_id?: number; status?: string; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) qs.set(k, String(v))
          }
        }
        const query = qs.toString()
        return get<WaterShutoffRecord[]>(`/water-shutoffs/records${query ? `?${query}` : ''}`)
      },
    },

    import: (data: { foia_request_id?: number; records: Record<string, unknown>[]; city?: string; state?: string }) =>
      post<{ status: string; imported: number; duplicates: number }>('/water-shutoffs/import', data),

    ingest: (recordIds: number[]) =>
      post<{ status: string; ingested: number; leads_created: number }>('/water-shutoffs/ingest', { record_ids: recordIds }),
  },

  fsbo: {
    stats: () => get<FsboStats>('/fsbo/stats'),
    scrapeStatus: () => get<FsboScrapeStatus>('/fsbo/scrape-status'),
    scrape: () => post<{ status: string; job_id?: string; message?: string }>('/fsbo/scrape', {}),

    markets: {
      list: () => get<FsboMarket[]>('/fsbo/markets'),
      upsert: (data: { metro: string; state: string; median_price?: number; zillow_search_url?: string }) =>
        post<{ status: string; id: number; action: string }>('/fsbo/markets', data),
      toggle: (marketId: number, active: boolean) =>
        post<{ status: string }>(`/fsbo/markets/${marketId}/toggle`, { active }),
    },

    listings: {
      list: (params?: { status?: string; min_score?: number; city?: string; state?: string; sort_by?: string; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) qs.set(k, String(v))
          }
        }
        const query = qs.toString()
        return get<FsboListing[]>(`/fsbo/listings${query ? `?${query}` : ''}`)
      },
      classify: (listingId: number, status: string, notes?: string) =>
        post<{ status: string }>(`/fsbo/listings/${listingId}/classify`, { status, notes }),
      bulkClassify: (listingIds: number[], status: string) =>
        post<{ status: string; updated: number }>('/fsbo/listings/bulk-classify', { listing_ids: listingIds, status }),
    },

    import: (data: { listings: Record<string, unknown>[]; market_metro?: string; market_state?: string }) =>
      post<{ status: string; imported: number; duplicates: number; scored: number }>('/fsbo/import', data),

    ingest: (listingIds: number[]) =>
      post<{ status: string; ingested: number; leads_created: number }>('/fsbo/ingest', { listing_ids: listingIds }),
  },

  courtRecords: {
    stats: () => get<CourtRecordStats>('/court-records/stats'),
    scrapeStatus: () => get<CourtRecordScrapeStatus>('/court-records/scrape-status'),

    counties: {
      list: () => get<CourtRecordCounty[]>('/court-records/counties'),
      upsert: (data: { county: string; state?: string; court_id: string; appraiser_url?: string; appraiser_type?: string }) =>
        post<{ status: string; id: number; action: string }>('/court-records/counties', data),
      toggle: (countyId: number, active: boolean) =>
        post<{ status: string }>(`/court-records/counties/${countyId}/toggle`, { active }),
    },

    cases: {
      list: (params?: { status?: string; county_id?: number; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) qs.set(k, String(v))
          }
        }
        const query = qs.toString()
        return get<CourtRecordCase[]>(`/court-records/cases${query ? `?${query}` : ''}`)
      },
      classify: (caseId: number, status: string) =>
        post<{ status: string }>(`/court-records/cases/${caseId}/classify`, { status }),
      bulkClassify: (caseIds: number[], status: string) =>
        post<{ status: string; updated: number }>('/court-records/cases/bulk-classify', { case_ids: caseIds, status }),
    },

    scrape: (params: { county: string; case_type?: string; days_back?: number }) =>
      post<{ status: string; job_id?: string; message?: string }>('/court-records/scrape', params),

    ingest: (caseIds: number[]) =>
      post<{ status: string; ingested: number; leads_created: number }>('/court-records/ingest', { case_ids: caseIds }),
  },

  counties: {
    stats: () => get<CountyScoutingStats>('/counties/stats'),
    list: (params?: { state?: string; tier?: string; scouted_only?: boolean; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      return get<CountyScouting[]>(`/counties${query ? `?${query}` : ''}`)
    },
    top: (limit = 50) => get<CountyScouting[]>(`/counties/top?limit=${limit}`),
    scoutQueue: (batchSize = 50) => get<CountyScouting[]>(`/counties/scout-queue?batch_size=${batchSize}`),
    scoutStatus: () => get<ScoutPipelineStatus>('/counties/scout-status'),
    seed: () => post<{ inserted: number; skipped: number }>('/counties/seed', {}),
    scout: (batchSize = 50) => post<{ status: string; counties?: number }>('/counties/scout', { batch_size: batchSize }),
    harvest: (batchSize = 10, signal = 'pre_foreclosure') =>
      post<{ status: string; counties?: number; signal?: string }>('/counties/harvest', { batch_size: batchSize, signal }),
    importScoutResults: (results: unknown[]) =>
      post<{ updated: number }>('/counties/import-scout-results', { results }),
  },

  distressedProperties: {
    list: (params?: { severity?: number; city?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      return get<{ total: number; properties: DistressedProperty[]; cities: string[] }>(`/distressed-properties${query ? `?${query}` : ''}`)
    },
  },

  callRecordings: {
    list: (params?: { search?: string; score?: string; motivation?: string; date_from?: string; date_to?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      return get<CallRecording[]>(`/call-recordings${query ? `?${query}` : ''}`)
    },
    get: (id: number) => get<CallRecording>(`/call-recordings/${id}`),
    stats: () => get<CallRecordingStats>('/call-recordings/stats'),
    create: async (formData: FormData) => {
      const res = await fetch(`${BASE}/call-recordings`, { method: 'POST', body: formData, headers: authHeaders() })
      if (!res.ok) throw new Error(`POST /call-recordings: ${res.status}`)
      return res.json() as Promise<{ status: string; id: number }>
    },
    update: (id: number, data: Record<string, unknown>) =>
      post<{ status: string; id: number }>(`/call-recordings/${id}`, data),
    delete: (id: number) =>
      post<{ status: string; id: number }>(`/call-recordings/${id}/delete`),
    transcribe: (id: number) =>
      post<{ status: string; id: number }>(`/call-recordings/${id}/transcribe`),
    grade: (id: number) =>
      post<{ status: string; id: number }>(`/call-recordings/${id}/grade`),
    audioUrl: (id: number) => `${BASE}/call-recordings/${id}/audio?token=${encodeURIComponent(localStorage.getItem('swarm_token') || '')}`,
    byLead: (leadId: string) =>
      get<CallRecording[]>(`/call-recordings/by-lead/${encodeURIComponent(leadId)}`),
    autoLink: (id: number) =>
      post<{ status: string; lead_id?: string; matches: Array<{ lead_id: string; owner_name: string; address_street: string; address_city: string; address_state: string; status: string }> }>(`/call-recordings/${id}/auto-link`),
    uploadSession: async (formData: FormData) => {
      const res = await fetch(`${BASE}/recordings/session`, { method: 'POST', body: formData, headers: authHeaders() })
      if (!res.ok) throw new Error(`POST /recordings/session: ${res.status}`)
      return res.json() as Promise<{ status: string; session_id: string; file: string }>
    },
  },

  contracts: {
    list: (params?: { lead_id?: string; status?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      return get<Contract[]>(`/contracts${query ? `?${query}` : ''}`)
    },
    get: (id: number) => get<Contract>(`/contracts/${id}`),
    create: (data: ContractData) =>
      post<{ status: string; id: number; signing_token: string }>('/contracts', data),
    sign: (id: number, role: string, signature: string) =>
      post<{ status: string; id: number; role: string }>(`/contracts/${id}/sign`, { role, signature }),
    send: (id: number, sellerEmail: string) =>
      post<{ status: string; signing_url?: string; email_sent_to?: string; message?: string }>(
        `/contracts/${id}/send`, { seller_email: sellerEmail },
      ),
    void: (id: number) =>
      post<{ status: string; id: number }>(`/contracts/${id}/void`),
    pdfUrl: (id: number) => `${BASE}/contracts/${id}/pdf`,
    uploadPdf: async (id: number, pdfBlob: Blob) => {
      const res = await fetch(`${BASE}/contracts/${id}/upload-pdf`, {
        method: 'POST',
        body: pdfBlob,
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`Upload PDF: ${res.status}`)
      return res.json() as Promise<{ status: string; path: string }>
    },
  },

  settings: {
    get: () => get<UserSettings>('/settings'),
    update: (data: Record<string, string>) =>
      post<{ status: string; updated: number }>('/settings', data),
  },

  agents: {
    list: () => get<AgentDefinition[]>('/agents'),
    get: (type: string) => get<AgentDefinition>(`/agents/${type}`),
    run: (type: string) => post<{ run_id: string; status: string }>(`/agents/${type}/run`),
    stop: (type: string) => post<{ status: string }>(`/agents/${type}/stop`),
    toggle: (type: string, enabled: boolean) =>
      post<{ updated: boolean }>(`/agents/${type}/toggle`, { enabled }),
    config: (type: string, cfg: Record<string, unknown>) =>
      post<{ updated: boolean }>(`/agents/${type}/config`, cfg),
    runs: (type: string) => get<AgentRun[]>(`/agents/${type}/runs`),
    run_detail: (type: string, runId: string) => get<AgentRun>(`/agents/${type}/runs/${runId}`),
    proxyStatus: () => get<AgentProxyStatus>('/agents/proxy-status'),
    proposals: {
      list: (params?: { status?: string; agent_type?: string; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params?.status) qs.set('status', params.status)
        if (params?.agent_type) qs.set('agent_type', params.agent_type)
        if (params?.limit) qs.set('limit', String(params.limit))
        const q = qs.toString()
        return get<Proposal[]>(`/agents/proposals${q ? `?${q}` : ''}`)
      },
      get: (id: number) => get<Proposal>(`/agents/proposals/${id}`),
      pendingCount: () => get<{ count: number }>('/agents/proposals/pending/count'),
      approve: (id: number) => post<{ executed: boolean }>(`/agents/proposals/${id}/approve`),
      deny: (id: number, reason?: string) =>
        post<{ id: number; status: string }>(`/agents/proposals/${id}/deny`, { reason }),
      revise: (id: number, notes: string) =>
        post<{ id: number; status: string }>(`/agents/proposals/${id}/revise`, { notes }),
      bulkApprove: (ids: number[]) =>
        post<{ approved: number }>('/agents/proposals/bulk-approve', { ids }),
      bulkDeny: (ids: number[], reason?: string) =>
        post<{ denied: number }>('/agents/proposals/bulk-deny', { ids, reason }),
    },
  },

  finances: {
    summary: () => get<FinanceSummary>('/finances/summary'),
    expenses: {
      list: () => get<Expense[]>('/finances/expenses'),
      save: (data: Partial<Expense>) => post<Expense>('/finances/expenses', data),
      delete: (id: number) => post<{ status: string }>('/finances/expenses', { id, _delete: true }),
    },
    revenue: {
      list: () => get<Revenue[]>('/finances/revenue'),
      add: (data: Partial<Revenue>) => post<Revenue>('/finances/revenue', data),
      delete: (id: number) => post<{ status: string }>('/finances/revenue', { id, _delete: true }),
    },
    payroll: {
      list: (weekStart?: string) =>
        get<PayrollEntry[]>(`/finances/payroll${weekStart ? `?week_start=${weekStart}` : ''}`),
      save: (data: Partial<PayrollEntry>) => post<{ id: number; status: string }>('/finances/payroll', data),
      markPaid: (id: number) => post<{ status: string }>('/finances/payroll', { id, _mark_paid: true }),
    },
  },

  activity: {
    liveStatus: () =>
      get<Array<{ user_id: number; name: string; active: boolean; today_dials: number; last_call: string | null; inactive_minutes: number | null }>>('/activity/live-status'),
    tracker: (userId: number, date: string) =>
      get<CallerActivity>(`/activity/tracker?user_id=${userId}&date=${date}`),
    summary: (dateFrom: string, dateTo: string, userId?: number) =>
      get<ActivityDaySummary[]>(`/activity/summary?date_from=${dateFrom}&date_to=${dateTo}${userId ? `&user_id=${userId}` : ''}`),
    integrity: (dateFrom: string, dateTo: string) =>
      get<IntegrityReport>(`/activity/integrity?date_from=${dateFrom}&date_to=${dateTo}`),
    dailyLogs: (dateFrom: string, dateTo: string, userId?: number) =>
      get<CallerDailyLog[]>(`/activity/daily-logs?date_from=${dateFrom}&date_to=${dateTo}${userId ? `&user_id=${userId}` : ''}`),
    submitLog: (data: { log_date: string; hours_claimed: number; dials_claimed: number; leads_set_claimed: number; notes?: string; user_id?: number }) =>
      post<{ status: string }>('/activity/daily-log', data),
  },

  schedule: {
    mine: (dateFrom: string, dateTo: string) =>
      get<CallerAvailability[]>(`/schedule?date_from=${dateFrom}&date_to=${dateTo}`),
    all: (dateFrom: string, dateTo: string) =>
      get<CallerAvailability[]>(`/schedule/all?date_from=${dateFrom}&date_to=${dateTo}`),
    save: (entries: Array<{ date: string; status: string; start_time?: string; end_time?: string }>, userId?: number) =>
      post<{ status: string; upserted: number }>('/schedule', { entries, user_id: userId }),
    delete: (date: string, startTime?: string, userId?: number) =>
      post<{ status: string; deleted: number }>('/schedule/delete', { date, start_time: startTime, user_id: userId }),
  },

  chat: {
    send: (message: string, conversationId?: number) =>
      post<ChatResponse>('/chat', { message, conversation_id: conversationId }),
    conversations: () =>
      get<Conversation[]>('/chat/conversations'),
    messages: (conversationId: number) =>
      get<{ conversation_id: number; messages: ConversationMessage[] }>(`/chat/conversations/${conversationId}`),
    confirm: (confirmationId: number) =>
      post<{ status: string; conversation_id: number; result?: unknown }>(`/chat/confirm/${confirmationId}`, {}),
    cancel: (confirmationId: number) =>
      post<{ status: string; conversation_id: number }>(`/chat/cancel/${confirmationId}`, {}),
  },
}
