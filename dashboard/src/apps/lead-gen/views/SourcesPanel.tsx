import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import { SocialBanditPanel } from './SocialBanditPanel'
import { WaterShutoffPanel } from './WaterShutoffPanel'
import { FsboPanel } from './FsboPanel'
import { CourtRecordsPanel } from './CourtRecordsPanel'

const PORTALS = [
  { id: 'cincinnati_oh', name: 'Cincinnati, OH', type: 'Socrata' },
  { id: 'austin_tx', name: 'Austin, TX', type: 'Socrata' },
  { id: 'cleveland_oh', name: 'Cleveland, OH', type: 'ArcGIS' },
  { id: 'fort_worth_tx', name: 'Fort Worth, TX', type: 'ArcGIS' },
]

export function SourcesPanel() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: sources, isLoading, error } = useQuery({
    queryKey: ['sources'],
    queryFn: hermesClient.sources.list,
    refetchInterval: 30_000,
  })

  const runPipeline = useMutation({
    mutationFn: () => hermesClient.pipeline.run(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const toggle = (key: string) => setExpanded((prev) => (prev === key ? null : key))

  if (isLoading) return <div style={{ color: '#666' }}>Loading sources...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: '#e0e0e0', fontSize: 20, margin: 0 }}>Lead Sources</h2>
        <button
          onClick={() => runPipeline.mutate()}
          disabled={runPipeline.isPending}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: runPipeline.isPending ? '#333' : '#6366f1',
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          {runPipeline.isPending ? 'Processing...' : 'Run Full Pipeline'}
        </button>
      </div>

      {runPipeline.isError && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          Pipeline failed: {runPipeline.error instanceof Error ? runPipeline.error.message : String(runPipeline.error)}
        </div>
      )}

      {error && (
        <div style={{
          padding: 16, background: '#1a1a2e', borderRadius: 8,
          border: '1px solid #2a2a3e', color: '#888', marginBottom: 16,
        }}>
          Connect to Hermes to view live source status.
        </div>
      )}

      {/* PropStream */}
      <PropStreamCard sources={sources || []} />

      {/* Code Violations */}
      <CodeViolationsCard />

      {/* Social / Bandit Comments */}
      <SocialBanditSection expanded={expanded === 'social-bandit'} onToggle={() => toggle('social-bandit')} />

      {/* Water Shutoffs */}
      <WaterShutoffSection expanded={expanded === 'water-shutoffs'} onToggle={() => toggle('water-shutoffs')} />

      {/* FSBOs */}
      <FsboSection expanded={expanded === 'fsbo'} onToggle={() => toggle('fsbo')} />

      {/* Court Records */}
      <CourtRecordsSection expanded={expanded === 'court-records'} onToggle={() => toggle('court-records')} />
    </div>
  )
}

/* ── Shared expand/collapse header ─────────────────────────── */

function SourceCardHeader({
  title,
  badges,
  statsRow,
  description,
  expanded,
  onToggle,
}: {
  title: string
  badges: { label: string; color: string }[]
  statsRow?: React.ReactNode
  description: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      style={{ cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 700 }}>{title}</span>
          {badges.map((b) => (
            <span key={b.label} style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
              color: b.color, background: b.color + '20',
            }}>
              {b.label}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {statsRow}
          <span style={{ color: '#444', fontSize: 12, marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#666' }}>{description}</div>
    </div>
  )
}

/* ── Social / Bandit ───────────────────────────────────────── */

function SocialBanditSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['social-bandit-stats'],
    queryFn: hermesClient.socialBandit.stats,
    refetchInterval: 30_000,
  })

  const hasData = stats && stats.total_comments > 0

  return (
    <div style={{
      background: '#111118', border: `1px solid ${expanded ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 10, padding: 20, marginBottom: 16,
      transition: 'border-color 0.15s',
    }}>
      <SourceCardHeader
        title="Social / Bandit Comments"
        badges={[
          { label: 'MINIMAL', color: '#ef4444' },
          { label: 'SEMI-MANUAL', color: '#f59e0b' },
        ]}
        statsRow={hasData ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#f59e0b' }}>{stats.new_comments} new</span>
            <span style={{ color: '#22c55e' }}>{stats.qualified_comments} qualified</span>
            <span style={{ color: '#6366f1' }}>{stats.ingested_leads} ingested</span>
          </div>
        ) : undefined}
        description="Harvest comments from your Facebook/Instagram ads and competitor ads."
        expanded={expanded}
        onToggle={onToggle}
      />
      {!expanded && hasData && (
        <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
          {stats.active_campaigns} active campaigns tracking {stats.total_comments} total comments
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 16, borderTop: '1px solid #1e1e2e', paddingTop: 16 }}>
          <SocialBanditPanel />
        </div>
      )}
    </div>
  )
}

/* ── Water Shutoffs ────────────────────────────────────────── */

function WaterShutoffSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['water-shutoff-stats'],
    queryFn: hermesClient.waterShutoffs.stats,
    refetchInterval: 30_000,
  })

  const hasData = stats && (stats.total_requests > 0 || stats.total_records > 0)

  return (
    <div style={{
      background: '#111118', border: `1px solid ${expanded ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 10, padding: 20, marginBottom: 16,
      transition: 'border-color 0.15s',
    }}>
      <SourceCardHeader
        title="Water Shutoff Lists"
        badges={[
          { label: 'PARTIAL', color: '#eab308' },
          { label: 'FOIA REQUIRED', color: '#f59e0b' },
        ]}
        statsRow={hasData ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#f59e0b' }}>{stats.pending_requests} pending</span>
            <span style={{ color: '#22c55e' }}>{stats.received_requests} received</span>
            <span style={{ color: '#6366f1' }}>{stats.total_records} records</span>
          </div>
        ) : undefined}
        description="Public records requests to city water utilities for disconnection lists."
        expanded={expanded}
        onToggle={onToggle}
      />
      {!expanded && hasData && (
        <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
          {stats.total_requests} FOIA requests tracked, {stats.ingested_records} leads ingested
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 16, borderTop: '1px solid #1e1e2e', paddingTop: 16 }}>
          <WaterShutoffPanel />
        </div>
      )}
    </div>
  )
}

/* ── FSBOs ─────────────────────────────────────────────────── */

function FsboSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['fsbo-stats'],
    queryFn: hermesClient.fsbo.stats,
    refetchInterval: 30_000,
  })

  const hasData = stats && stats.total_listings > 0

  return (
    <div style={{
      background: '#111118', border: `1px solid ${expanded ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 10, padding: 20, marginBottom: 16,
      transition: 'border-color 0.15s',
    }}>
      <SourceCardHeader
        title="FSBOs (Zillow)"
        badges={[
          { label: 'MODERATE', color: '#3b82f6' },
          { label: 'SEMI-MANUAL', color: '#f59e0b' },
        ]}
        statsRow={hasData ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#ef4444' }}>{stats.hot_listings} hot</span>
            <span style={{ color: '#22c55e' }}>{stats.qualified_listings} qualified</span>
            <span style={{ color: '#6366f1' }}>{stats.ingested_leads} ingested</span>
          </div>
        ) : undefined}
        description="For Sale By Owner listings from Zillow. Auto-scored for distress signals."
        expanded={expanded}
        onToggle={onToggle}
      />
      {!expanded && hasData && (
        <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
          {stats.total_listings} listings tracked, avg distress score {stats.avg_distress_score}
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 16, borderTop: '1px solid #1e1e2e', paddingTop: 16 }}>
          <FsboPanel />
        </div>
      )}
    </div>
  )
}

/* ── Court Records (CaseNet) ──────────────────────────────── */

function CourtRecordsSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['court-record-stats'],
    queryFn: hermesClient.courtRecords.stats,
    refetchInterval: 30_000,
  })

  const hasData = stats && stats.total_cases > 0

  return (
    <div style={{
      background: '#111118', border: `1px solid ${expanded ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 10, padding: 20, marginBottom: 16,
      transition: 'border-color 0.15s',
    }}>
      <SourceCardHeader
        title="Court Records (CaseNet)"
        badges={[
          { label: 'PARTIAL', color: '#f59e0b' },
          { label: 'BROWSER', color: '#ef4444' },
        ]}
        statsRow={hasData ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#22c55e' }}>{stats.with_property} w/ property</span>
            <span style={{ color: '#f59e0b' }}>{stats.new_cases} new</span>
            <span style={{ color: '#6366f1' }}>{stats.ingested_cases} ingested</span>
          </div>
        ) : undefined}
        description="Missouri probate & civil records from Case.net. Cross-references county property appraiser."
        expanded={expanded}
        onToggle={onToggle}
      />
      {!expanded && hasData && (
        <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
          {stats.total_cases} cases across {stats.active_counties} active {stats.active_counties === 1 ? 'county' : 'counties'}
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 16, borderTop: '1px solid #1e1e2e', paddingTop: 16 }}>
          <CourtRecordsPanel />
        </div>
      )}
    </div>
  )
}

/* ── PropStream ────────────────────────────────────────────── */

function PropStreamCard({ sources }: { sources: { source_id: string; source_name: string; data_quality_tier: string; enabled: boolean; last_run_at: string | null; last_run_status: string | null; last_run_count: number | null }[] }) {
  const queryClient = useQueryClient()
  const ps = sources.find((s) => s.source_id === 'propstream')

  const runSource = useMutation({
    mutationFn: () => hermesClient.sources.run('propstream'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
  })

  return (
    <div style={{
      background: '#111118', border: '1px solid #1e1e2e', borderRadius: 10, padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 700 }}>PropStream</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            color: '#22c55e', background: '#22c55e20',
          }}>FULL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {ps?.last_run_at && (
            <span style={{ fontSize: 11, color: '#555' }}>
              {new Date(ps.last_run_at).toLocaleDateString()} &middot; {ps.last_run_count?.toLocaleString() ?? 0} leads
            </span>
          )}
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: ps ? '#22c55e' : '#ef4444',
          }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
        Tax delinquency, foreclosure, probate filters &middot; Browser bridge automation
      </div>
      <button
        onClick={() => runSource.mutate()}
        disabled={runSource.isPending || !ps}
        style={{
          padding: '7px 14px', borderRadius: 5, border: '1px solid #2a2a3e',
          background: '#1a1a2e', color: '#aaa', fontSize: 12, cursor: 'pointer',
        }}
      >
        {runSource.isPending ? 'Running...' : 'Run PropStream Scan'}
      </button>
      {runSource.isError && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginTop: 10,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          Scan failed: {runSource.error instanceof Error ? runSource.error.message : String(runSource.error)}
        </div>
      )}
    </div>
  )
}

/* ── Code Violations ───────────────────────────────────────── */

function CodeViolationsCard() {
  const queryClient = useQueryClient()
  const [scrapeResult, setScrapeResult] = useState<{
    status: string; portals_scraped: number; total_leads: number;
    details: { portal: string; name?: string; status: string; count?: number }[]
  } | null>(null)
  const [skipTraceResult, setSkipTraceResult] = useState<{
    status: string; queued: number; zip_groups?: number; note?: string; message?: string
  } | null>(null)

  const scrape = useMutation({
    mutationFn: () => hermesClient.sources.scrapeCodeViolations(),
    onSuccess: (data) => {
      setScrapeResult(data)
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: (err) => setScrapeResult({ status: 'error', portals_scraped: 0, total_leads: 0, details: [{ portal: 'all', status: `Error: ${err}` }] }),
  })

  const skipTrace = useMutation({
    mutationFn: () => hermesClient.skipTrace.queue({ source: 'code_violations', limit: 200 }),
    onSuccess: (data) => {
      setSkipTraceResult(data)
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
    onError: (err) => setSkipTraceResult({ status: 'error', queued: 0, message: String(err) }),
  })

  const isDone = scrapeResult && scrapeResult.status === 'ok'

  return (
    <div style={{
      background: '#111118', border: '1px solid #1e1e2e', borderRadius: 10, padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 700 }}>Code Violations</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            color: '#eab308', background: '#eab30820',
          }}>PARTIAL</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            color: '#22c55e', background: '#22c55e15',
          }}>AUTONOMOUS</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>
        Public API scraping &middot; {PORTALS.length} city portals &middot; Socrata + ArcGIS
      </div>

      {/* Portal list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 16 }}>
        {PORTALS.map((p) => {
          const detail = scrapeResult?.details?.find((d) => d.portal === p.id)
          const portalOk = detail?.status === 'ok'
          return (
            <div key={p.id} style={{
              padding: '8px 12px', background: '#0d0d14', borderRadius: 6,
              border: `1px solid ${portalOk ? '#22c55e30' : '#1a1a2e'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ color: '#ccc', fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                <div style={{ color: '#444', fontSize: 10 }}>{p.type}</div>
              </div>
              {detail && (
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: portalOk ? '#22c55e' : '#ef4444',
                }}>
                  {portalOk ? `${detail.count} leads` : detail.status}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => { setScrapeResult(null); scrape.mutate() }}
          disabled={scrape.isPending}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none',
            background: scrape.isPending ? '#333' : '#6366f1',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {scrape.isPending ? 'Scraping...' : isDone ? 'Re-Scrape Portals' : 'Scrape Code Violations'}
        </button>

        <button
          onClick={() => { setSkipTraceResult(null); skipTrace.mutate() }}
          disabled={skipTrace.isPending}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none',
            background: skipTrace.isPending ? '#333' : '#8b5cf6',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {skipTrace.isPending ? 'Queuing...' : 'Harvest + Skip Trace'}
        </button>
      </div>

      {/* Scrape results */}
      {scrapeResult && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 6,
          background: scrapeResult.status === 'ok' ? '#0f1f0f' : '#1f0f0f',
          border: `1px solid ${scrapeResult.status === 'ok' ? '#1a3a1a' : '#3a1a1a'}`,
        }}>
          {scrapeResult.status === 'ok' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>
                {scrapeResult.portals_scraped} portals scraped
              </span>
              <span style={{ color: '#4ade80', fontSize: 15, fontWeight: 700 }}>
                {scrapeResult.total_leads.toLocaleString()} leads ingested
              </span>
            </div>
          ) : (
            <span style={{ color: '#ef4444', fontSize: 12 }}>
              Scrape failed: {scrapeResult.details?.[0]?.status || 'Unknown error'}
            </span>
          )}
        </div>
      )}

      {/* Skip trace results */}
      {skipTraceResult && (
        <div style={{
          marginTop: 8, padding: '10px 14px', borderRadius: 6,
          background: skipTraceResult.status === 'ok' ? '#0f0f1f' : '#1f0f0f',
          border: `1px solid ${skipTraceResult.status === 'ok' ? '#1a1a3a' : '#3a1a1a'}`,
        }}>
          {skipTraceResult.status === 'ok' ? (
            <div>
              <div style={{ color: '#a78bfa', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{skipTraceResult.queued} leads</span> across {skipTraceResult.zip_groups ?? '?'} zip codes queued for harvest
                {skipTraceResult.queued === 0 && <span style={{ color: '#666' }}> — all leads already have phones</span>}
              </div>
              {skipTraceResult.queued > 0 && (
                <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                  Each zip runs: SEARCH → SAVE → SKIP TRACE → EXPORT. PropStream runner must be active.
                </div>
              )}
            </div>
          ) : (
            <span style={{ color: '#ef4444', fontSize: 12 }}>
              Skip trace error: {skipTraceResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
