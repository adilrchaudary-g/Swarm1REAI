import type { Lead, PhoneRecord, PipelineStats, SourceAdapter, KpiSummary, FollowUp, MarketInfo, SocialComment, SocialCampaign, SocialBanditStats, FoiaRequest, WaterShutoffRecord, WaterShutoffStats, FsboListing, FsboMarket, FsboStats } from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
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
    (p) => p.phone_type?.toLowerCase() === 'cell' || p.phone_type?.toLowerCase() === 'mobile'
  )

  return {
    ...raw,
    distress_signals,
    callable_phones: callable_phones.length > 0 ? callable_phones : phones,
    phone_numbers: phones,
  }
}

export const hermesClient = {
  leads: {
    list: async (params?: { status?: string; tier?: string; source?: string; persona?: string; limit?: number; offset?: number }) => {
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
    updateStatus: (id: string, status: string, reason?: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/status`, { status, reason }),
    addNote: (id: string, note_type: string, content: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/notes`, { note_type, content }),
    archive: (id: string, reason?: string) =>
      post<{ status: string; lead_id: string }>(`/leads/${id}/status`, { status: 'archived', reason: reason || 'Bad number' }),
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
    scrapeCodeViolations: (params?: { portal_ids?: string[]; days_back?: number; limit?: number }) =>
      post<{ status: string; portals_scraped: number; total_leads: number; details: any[] }>(
        '/sources/code_violations/scrape', params,
      ),
  },

  skipTrace: {
    queue: (params?: { lead_ids?: string[]; source?: string; limit?: number }) =>
      post<{ status: string; queued: number; command_id?: string }>('/skip-trace/queue', params),
  },

  quota: () => get<Record<string, number>>('/quota'),

  kpi: {
    summary: () => get<KpiSummary>('/kpi/summary'),
  },

  markets: {
    list: () => get<{ status: string; markets: MarketInfo[] }>('/markets'),
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
}
