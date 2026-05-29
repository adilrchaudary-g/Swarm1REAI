import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import type { FsboListing } from '../../../api/types'

type SubView = 'listings' | 'markets'

const MARKET_PRESETS: { metro: string; state: string; median_price: number; zillow_search_url: string }[] = [
  { metro: 'Cincinnati', state: 'OH', median_price: 230000, zillow_search_url: 'https://www.zillow.com/cincinnati-oh/fsbo/' },
  { metro: 'Columbus', state: 'OH', median_price: 270000, zillow_search_url: 'https://www.zillow.com/columbus-oh/fsbo/' },
  { metro: 'Cleveland', state: 'OH', median_price: 120000, zillow_search_url: 'https://www.zillow.com/cleveland-oh/fsbo/' },
  { metro: 'Akron', state: 'OH', median_price: 115000, zillow_search_url: 'https://www.zillow.com/akron-oh/fsbo/' },
  { metro: 'Dayton', state: 'OH', median_price: 140000, zillow_search_url: 'https://www.zillow.com/dayton-oh/fsbo/' },
  { metro: 'Toledo', state: 'OH', median_price: 105000, zillow_search_url: 'https://www.zillow.com/toledo-oh/fsbo/' },
  { metro: 'Houston', state: 'TX', median_price: 320000, zillow_search_url: 'https://www.zillow.com/houston-tx/fsbo/' },
  { metro: 'Dallas', state: 'TX', median_price: 365000, zillow_search_url: 'https://www.zillow.com/dallas-tx/fsbo/' },
  { metro: 'Fort Worth', state: 'TX', median_price: 310000, zillow_search_url: 'https://www.zillow.com/fort-worth-tx/fsbo/' },
  { metro: 'San Antonio', state: 'TX', median_price: 270000, zillow_search_url: 'https://www.zillow.com/san-antonio-tx/fsbo/' },
  { metro: 'Austin', state: 'TX', median_price: 450000, zillow_search_url: 'https://www.zillow.com/austin-tx/fsbo/' },
]

// statusPulse keyframe is in index.css

export function FsboPanel() {
  const [subView, setSubView] = useState<SubView>('listings')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { id: 'listings' as const, label: 'Listings' },
          { id: 'markets' as const, label: 'Markets' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubView(tab.id)}
            style={{
              padding: '6px 14px', borderRadius: 5,
              border: `1px solid ${subView === tab.id ? '#6366f1' : '#2a2a3e'}`,
              background: subView === tab.id ? '#6366f120' : 'transparent',
              color: subView === tab.id ? '#818cf8' : '#666',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subView === 'listings' && <ListingsView />}
      {subView === 'markets' && <MarketsView />}
    </div>
  )
}

/* ── Listings View ─────────────────────────────────────────── */

function distressColor(score: number): string {
  if (score >= 60) return '#ef4444'
  if (score >= 40) return '#f59e0b'
  if (score >= 20) return '#eab308'
  return '#666'
}

function formatPrice(val: number | null | undefined): string {
  if (val == null) return '-'
  return '$' + val.toLocaleString()
}

function ListingsView() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('distress_score')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [ingestResult, setIngestResult] = useState<{ leads_created: number; ingested: number } | null>(null)
  const [scrapeOpen, setScrapeOpen] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  const scrape = useMutation({
    mutationFn: () => hermesClient.fsbo.scrape(),
    onMutate: () => setScrapeOpen(true),
  })

  const { data: scrapeStatus } = useQuery({
    queryKey: ['fsbo-scrape-status'],
    queryFn: hermesClient.fsbo.scrapeStatus,
    refetchInterval: scrapeOpen ? 2000 : false,
    enabled: scrapeOpen,
  })

  useEffect(() => {
    if (scrapeStatus && !scrapeStatus.running && scrapeStatus.phase === 'complete') {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-markets'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    }
  }, [scrapeStatus?.running, scrapeStatus?.phase, queryClient])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scrapeStatus?.log_lines?.length])

  const isRunning = scrapeStatus?.running || scrape.isPending

  const { data: listings, isLoading } = useQuery({
    queryKey: ['fsbo-listings', statusFilter, sortBy],
    queryFn: () => hermesClient.fsbo.listings.list({
      status: statusFilter || undefined,
      sort_by: sortBy,
      limit: 200,
    }),
    refetchInterval: 30_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['fsbo-stats'],
    queryFn: hermesClient.fsbo.stats,
    refetchInterval: 30_000,
  })

  const classifyListing = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      hermesClient.fsbo.listings.classify(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
    },
  })

  const bulkClassify = useMutation({
    mutationFn: (status: string) =>
      hermesClient.fsbo.listings.bulkClassify(Array.from(selectedIds), status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
      setSelectedIds(new Set())
    },
  })

  const ingestListings = useMutation({
    mutationFn: () => hermesClient.fsbo.ingest(Array.from(selectedIds)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      setSelectedIds(new Set())
      setIngestResult(data)
    },
  })

  const ingestAll = useMutation({
    mutationFn: () => {
      const qualifiedIds = (listings || [])
        .filter((l) => l.status === 'qualified' || (l.status === 'new' && l.distress_score >= 40))
        .map((l) => l.id)
      return hermesClient.fsbo.ingest(qualifiedIds)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      setIngestResult(data)
    },
  })

  const toggleId = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  if (isLoading) return <div style={{ color: '#666' }}>Loading listings...</div>

  const qualifiableCount = (listings || []).filter(
    (l) => l.status === 'qualified' || (l.status === 'new' && l.distress_score >= 40),
  ).length

  return (
    <div>
      {/* Scrape banner */}
      <div style={{
        marginBottom: 16, padding: '12px 14px',
        background: isRunning ? '#6366f110' : '#111118',
        border: `1px solid ${isRunning ? '#6366f130' : '#1e1e2e'}`,
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>
              Zillow FSBO Scraper
            </span>
            <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              {isRunning
                ? 'Scraping active markets — watch progress below.'
                : 'Scrape all active markets, auto-score, and ingest qualified leads.'}
            </div>
          </div>
          <button
            onClick={() => {
              if (isRunning) {
                setScrapeOpen((o) => !o)
              } else {
                scrape.mutate()
              }
            }}
            disabled={scrape.isPending}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              color: isRunning ? '#eab308' : '#fff',
              background: isRunning ? '#eab30818' : '#6366f1',
            }}
          >
            {scrape.isPending
              ? 'Starting...'
              : isRunning
                ? (scrapeOpen ? 'Hide Log' : 'Show Log')
                : 'Scrape FSBOs'}
          </button>
        </div>

        {scrape.isError && (
          <div style={{ padding: '6px 10px', borderRadius: 4, marginTop: 8, background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 11 }}>
            Failed: {scrape.error instanceof Error ? scrape.error.message : String(scrape.error)}
          </div>
        )}

        {scrapeOpen && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: isRunning ? '#22c55e' : (scrapeStatus?.error ? '#ef4444' : '#22c55e'),
                  animation: isRunning ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
                }} />
                <span style={{ color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {scrape.isPending && 'Starting...'}
                  {scrapeStatus?.phase === 'launching' && 'Launching browser...'}
                  {scrapeStatus?.phase === 'waiting_for_browser' && 'Waiting for browser...'}
                  {scrapeStatus?.phase === 'scraping' && 'Scraping listings...'}
                  {scrapeStatus?.phase === 'enriching' && 'Enriching detail pages...'}
                  {scrapeStatus?.phase === 'importing' && 'Importing to database...'}
                  {scrapeStatus?.phase === 'ingesting' && 'Auto-ingesting leads...'}
                  {scrapeStatus?.phase === 'complete' && 'Complete'}
                  {scrapeStatus?.phase === 'error' && 'Failed'}
                  {!scrape.isPending && scrapeStatus?.phase === 'idle' && 'Idle'}
                  {!scrape.isPending && !scrapeStatus && 'Connecting...'}
                </span>
              </div>
              {!isRunning && (
                <button
                  onClick={() => setScrapeOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14 }}
                ><X size={16} /></button>
              )}
            </div>
            <div className={`log-tablet${isRunning ? ' active' : scrapeStatus?.error ? ' error' : scrapeStatus?.phase === 'complete' ? ' complete' : ''}`}>
              {(scrapeStatus?.log_lines || []).map((line, i) => (
                <div key={i} style={{
                  color: line.includes('ERROR') ? '#ef4444'
                    : line.includes('[zillow]') ? '#6366f1'
                      : line.includes('Imported') ? '#22c55e'
                        : line.includes('Auto-ingest') ? '#eab308'
                          : '#888',
                }}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
            {scrapeStatus?.error && (
              <div style={{ marginTop: 6, padding: '6px 10px', background: '#ef444418', borderRadius: 4, color: '#ef4444', fontSize: 11 }}>
                {scrapeStatus.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {[
            { label: 'Total', value: stats.total_listings, color: '#6366f1' },
            { label: 'Hot (40+)', value: stats.hot_listings, color: '#ef4444' },
            { label: 'Avg Score', value: stats.avg_distress_score, color: '#f59e0b' },
            { label: 'Qualified', value: stats.qualified_listings, color: '#22c55e' },
            { label: 'Ingested', value: stats.ingested_leads, color: '#3b82f6' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { val: '', label: 'All' },
            { val: 'new', label: 'New' },
            { val: 'qualified', label: 'Qualified' },
            { val: 'ingested', label: 'Ingested' },
            { val: 'junk', label: 'Junk' },
          ].map((f) => (
            <button
              key={f.val}
              onClick={() => { setStatusFilter(f.val); setSelectedIds(new Set()) }}
              style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11,
                border: `1px solid ${statusFilter === f.val ? '#6366f1' : '#2a2a3e'}`,
                background: statusFilter === f.val ? '#6366f120' : 'transparent',
                color: statusFilter === f.val ? '#818cf8' : '#666',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
          <span style={{ color: '#333', margin: '0 4px' }}>|</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: 4, border: '1px solid #2a2a3e',
              background: '#0d0d14', color: '#888', fontSize: 11,
            }}
          >
            <option value="distress_score">Sort: Distress Score</option>
            <option value="dom">Sort: Days on Market</option>
            <option value="price">Sort: Price (Low)</option>
            <option value="drops">Sort: Price Drops</option>
            <option value="newest">Sort: Newest First</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => bulkClassify.mutate('qualified')}
                disabled={bulkClassify.isPending}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: '1px solid #22c55e40',
                  background: bulkClassify.isPending ? '#22c55e30' : '#22c55e15', color: '#22c55e', fontSize: 11, cursor: 'pointer',
                }}
              >
                {bulkClassify.isPending ? 'Qualifying...' : `Qualify ${selectedIds.size}`}
              </button>
              <button
                onClick={() => bulkClassify.mutate('junk')}
                disabled={bulkClassify.isPending}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: '1px solid #ef444440',
                  background: bulkClassify.isPending ? '#ef444430' : '#ef444415', color: '#ef4444', fontSize: 11, cursor: 'pointer',
                }}
              >
                {bulkClassify.isPending ? 'Junking...' : `Junk ${selectedIds.size}`}
              </button>
              <button
                onClick={() => ingestListings.mutate()}
                disabled={ingestListings.isPending}
                style={{
                  padding: '5px 12px', borderRadius: 5, border: 'none',
                  background: ingestListings.isPending ? '#4f46e5' : '#6366f1', color: '#fff', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                {ingestListings.isPending ? 'Ingesting...' : `Ingest ${selectedIds.size}`}
              </button>
            </>
          )}
          {selectedIds.size === 0 && qualifiableCount > 0 && (
            <button
              onClick={() => ingestAll.mutate()}
              disabled={ingestAll.isPending}
              style={{
                padding: '6px 14px', borderRadius: 5, border: 'none',
                background: '#22c55e', color: '#fff', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {ingestAll.isPending ? 'Ingesting...' : `Ingest All ${qualifiableCount} Qualified`}
            </button>
          )}
        </div>
      </div>

      {(ingestListings.isError || ingestAll.isError || bulkClassify.isError || classifyListing.isError) && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {ingestListings.isError && `Ingest failed: ${ingestListings.error instanceof Error ? ingestListings.error.message : String(ingestListings.error)}`}
          {ingestAll.isError && `Ingest all failed: ${ingestAll.error instanceof Error ? ingestAll.error.message : String(ingestAll.error)}`}
          {bulkClassify.isError && `Classify failed: ${bulkClassify.error instanceof Error ? bulkClassify.error.message : String(bulkClassify.error)}`}
          {classifyListing.isError && `Classify failed: ${classifyListing.error instanceof Error ? classifyListing.error.message : String(classifyListing.error)}`}
        </div>
      )}

      {ingestResult && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#0f1f0f', border: '1px solid #1a3a1a',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#4ade80', fontSize: 13 }}>
            <strong>{ingestResult.leads_created}</strong> leads created from {ingestResult.ingested} listings
          </span>
          <button
            onClick={() => setIngestResult(null)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
          ><X size={16} /></button>
        </div>
      )}

      {/* Listing cards */}
      {(!listings || listings.length === 0) ? (
        <div style={{ color: '#555', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No FSBO listings found. Click "Scrape FSBOs" above to pull listings from Zillow.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {listings.map((lst) => (
            <ListingCard
              key={lst.id}
              listing={lst}
              selected={selectedIds.has(lst.id)}
              expanded={expandedId === lst.id}
              onToggleSelect={() => toggleId(lst.id)}
              onToggleExpand={() => setExpandedId(expandedId === lst.id ? null : lst.id)}
              onClassify={(status) => classifyListing.mutate({ id: lst.id, status })}
              classifyPending={classifyListing.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ListingCard({
  listing: lst,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onClassify,
  classifyPending,
}: {
  listing: FsboListing
  selected: boolean
  expanded: boolean
  onToggleSelect: () => void
  onToggleExpand: () => void
  onClassify: (status: string) => void
  classifyPending?: boolean
}) {
  const scoreColor = distressColor(lst.distress_score)
  let flags: string[] = []
  try {
    flags = lst.distress_flags_json ? JSON.parse(lst.distress_flags_json) : []
  } catch { /* empty */ }

  const statusColors: Record<string, string> = {
    new: '#f59e0b',
    qualified: '#22c55e',
    junk: '#ef4444',
    ingested: '#6366f1',
  }

  return (
    <div style={{
      background: selected ? '#6366f108' : '#111118',
      border: `1px solid ${selected ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 8, padding: '10px 14px',
      borderLeft: `3px solid ${scoreColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          style={{ accentColor: '#6366f1' }}
        />

        {/* Distress score badge */}
        <div style={{
          width: 36, height: 36, borderRadius: 6,
          background: scoreColor + '20', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor }}>
            {lst.distress_score}
          </span>
        </div>

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onToggleExpand}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>
              {lst.address}
            </span>
            {lst.city && (
              <span style={{ color: '#555', fontSize: 11 }}>
                {lst.city}, {lst.state}
              </span>
            )}
            <span style={{
              padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
              color: statusColors[lst.status] || '#666',
              background: (statusColors[lst.status] || '#666') + '20',
              textTransform: 'uppercase',
            }}>
              {lst.status}
            </span>
          </div>

          {/* Key metrics row */}
          <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: '#888' }}>
            <span style={{ color: '#e0e0e0', fontWeight: 600 }}>
              {formatPrice(lst.asking_price)}
            </span>
            {lst.days_on_market != null && (
              <span style={{ color: lst.days_on_market >= 90 ? '#ef4444' : lst.days_on_market >= 60 ? '#f59e0b' : '#888' }}>
                {lst.days_on_market} DOM
              </span>
            )}
            {lst.price_drops > 0 && (
              <span style={{ color: '#ef4444' }}>
                {lst.price_drops} price drop{lst.price_drops > 1 ? 's' : ''}
              </span>
            )}
            {lst.price_drop_pct != null && lst.price_drop_pct > 0 && (
              <span style={{ color: '#ef4444' }}>
                -{lst.price_drop_pct.toFixed(0)}%
              </span>
            )}
            {lst.zestimate != null && lst.asking_price != null && lst.asking_price < lst.zestimate && (
              <span style={{ color: '#22c55e' }}>
                {((1 - lst.asking_price / lst.zestimate) * 100).toFixed(0)}% below Zestimate
              </span>
            )}
            {lst.sqft && <span>{lst.sqft.toLocaleString()} sqft</span>}
            {lst.bedrooms != null && lst.bathrooms != null && (
              <span>{lst.bedrooms}bd/{lst.bathrooms}ba</span>
            )}
          </div>

          {/* Distress flags */}
          {flags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {flags.slice(0, 6).map((flag, i) => (
                <span key={i} style={{
                  padding: '1px 5px', borderRadius: 3, fontSize: 9,
                  color: '#f59e0b', background: '#f59e0b15',
                  border: '1px solid #f59e0b25',
                }}>
                  {flag}
                </span>
              ))}
              {flags.length > 6 && (
                <span style={{ fontSize: 9, color: '#555' }}>+{flags.length - 6} more</span>
              )}
            </div>
          )}
        </div>

        {/* Quick actions */}
        {lst.status !== 'ingested' && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: classifyPending ? 0.5 : 1, transition: 'opacity 0.15s' }}>
            {lst.status !== 'qualified' && (
              <button
                onClick={() => onClassify('qualified')}
                disabled={classifyPending}
                title="Qualify"
                style={{
                  width: 28, height: 28, borderRadius: 4, border: '1px solid #22c55e30',
                  background: '#22c55e10', color: '#22c55e', fontSize: 14,
                  cursor: classifyPending ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                +
              </button>
            )}
            {lst.status !== 'junk' && (
              <button
                onClick={() => onClassify('junk')}
                disabled={classifyPending}
                title="Mark junk"
                style={{
                  width: 28, height: 28, borderRadius: 4, border: '1px solid #ef444430',
                  background: '#ef444410', color: '#ef4444', fontSize: 14,
                  cursor: classifyPending ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                x
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: '1px solid #1a1a2e',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 11,
        }}>
          <DetailRow label="Asking Price" value={formatPrice(lst.asking_price)} />
          <DetailRow label="Original Price" value={formatPrice(lst.original_price)} />
          <DetailRow label="Zestimate" value={formatPrice(lst.zestimate)} />
          <DetailRow label="Days on Market" value={lst.days_on_market != null ? String(lst.days_on_market) : '-'} />
          <DetailRow label="Price Drops" value={String(lst.price_drops)} />
          <DetailRow label="Drop %" value={lst.price_drop_pct != null ? `${lst.price_drop_pct.toFixed(1)}%` : '-'} />
          <DetailRow label="Beds / Baths" value={`${lst.bedrooms ?? '-'} / ${lst.bathrooms ?? '-'}`} />
          <DetailRow label="Sqft" value={lst.sqft ? lst.sqft.toLocaleString() : '-'} />
          <DetailRow label="Year Built" value={lst.year_built ? String(lst.year_built) : '-'} />
          <DetailRow label="Photos" value={lst.photo_count != null ? String(lst.photo_count) : '-'} />

          {lst.zillow_url && (
            <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <a
                href={lst.zillow_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#6366f1', fontSize: 11, textDecoration: 'underline' }}
              >
                View on Zillow
              </a>
            </div>
          )}

          {lst.description && (
            <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <div style={{ color: '#555', fontSize: 10, marginBottom: 2 }}>DESCRIPTION</div>
              <div style={{
                color: '#888', fontSize: 11, lineHeight: 1.5,
                maxHeight: 80, overflow: 'auto', padding: 8,
                background: '#0d0d14', borderRadius: 4,
              }}>
                {lst.description}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#555' }}>{label}</span>
      <span style={{ color: '#ccc' }}>{value}</span>
    </div>
  )
}

/* ── Markets View ──────────────────────────────────────────── */

function MarketsView() {
  const queryClient = useQueryClient()

  const { data: markets, isLoading } = useQuery({
    queryKey: ['fsbo-markets'],
    queryFn: hermesClient.fsbo.markets.list,
    refetchInterval: 30_000,
  })

  const upsertMarket = useMutation({
    mutationFn: (preset: typeof MARKET_PRESETS[0]) =>
      hermesClient.fsbo.markets.upsert({
        metro: preset.metro,
        state: preset.state,
        median_price: preset.median_price,
        zillow_search_url: preset.zillow_search_url,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-markets'] })
    },
  })

  const toggleMarket = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      hermesClient.fsbo.markets.toggle(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-markets'] })
    },
  })

  if (isLoading) return <div style={{ color: '#666' }}>Loading markets...</div>

  const existingKeys = new Set((markets || []).map((m) => `${m.metro}-${m.state}`))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ color: '#aaa', fontSize: 14, margin: 0 }}>FSBO Target Markets</h3>
      </div>

      <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        Markets define median prices for distress scoring. Listings priced below median
        get higher scores. Click a market to add it, then use its Zillow link to browse FSBOs.
      </div>

      {/* Active markets */}
      {(upsertMarket.isError || toggleMarket.isError) && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {upsertMarket.isError && `Add market failed: ${upsertMarket.error instanceof Error ? upsertMarket.error.message : String(upsertMarket.error)}`}
          {toggleMarket.isError && `Toggle failed: ${toggleMarket.error instanceof Error ? toggleMarket.error.message : String(toggleMarket.error)}`}
        </div>
      )}

      {markets && markets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {markets.map((m) => (
            <div key={m.id} style={{
              background: '#111118', border: `1px solid ${m.active ? '#1e1e2e' : '#161620'}`,
              borderRadius: 8, padding: 14,
              opacity: m.active ? 1 : 0.5,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600 }}>
                    {m.metro}, {m.state}
                  </span>
                  <span style={{ color: '#555', fontSize: 11, marginLeft: 10 }}>
                    Median: {m.median_price ? `$${m.median_price.toLocaleString()}` : 'Not set'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {m.current_listings > 0 && (
                    <span style={{ fontSize: 11, color: '#6366f1' }}>
                      {m.current_listings} listings ({m.hot_listings} hot)
                    </span>
                  )}
                  {m.last_scanned_at && (
                    <span style={{ fontSize: 10, color: '#444' }}>
                      Scanned {new Date(m.last_scanned_at).toLocaleDateString()}
                    </span>
                  )}
                  {m.zillow_search_url && (
                    <a
                      href={m.zillow_search_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '4px 10px', borderRadius: 4, border: '1px solid #2a2a3e',
                        background: '#1a1a2e', color: '#aaa', fontSize: 11,
                        textDecoration: 'none', cursor: 'pointer',
                      }}
                    >
                      Open Zillow
                    </a>
                  )}
                  <button
                    onClick={() => toggleMarket.mutate({ id: m.id, active: !m.active })}
                    disabled={toggleMarket.isPending}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11,
                      border: `1px solid ${m.active ? '#ef444430' : '#22c55e30'}`,
                      background: m.active ? '#ef444410' : '#22c55e10',
                      color: m.active ? '#ef4444' : '#22c55e',
                      cursor: toggleMarket.isPending ? 'wait' : 'pointer',
                      opacity: toggleMarket.isPending ? 0.5 : 1,
                    }}
                  >
                    {toggleMarket.isPending ? '...' : m.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add markets from presets */}
      <h4 style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>Add Markets</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {MARKET_PRESETS.map((preset) => {
          const exists = existingKeys.has(`${preset.metro}-${preset.state}`)
          return (
            <button
              key={`${preset.metro}-${preset.state}`}
              onClick={() => !exists && upsertMarket.mutate(preset)}
              disabled={exists || upsertMarket.isPending}
              style={{
                padding: '10px 14px', borderRadius: 6, textAlign: 'left',
                border: `1px solid ${exists ? '#1a1a2e' : '#2a2a3e'}`,
                background: exists ? '#0d0d14' : '#1a1a2e',
                cursor: exists ? 'not-allowed' : 'pointer',
                opacity: exists ? 0.5 : 1,
              }}
            >
              <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>
                {preset.metro}, {preset.state}
              </div>
              <div style={{ color: '#555', fontSize: 10, marginTop: 2 }}>
                Median: ${preset.median_price.toLocaleString()}
              </div>
              {exists && <div style={{ color: '#6366f1', fontSize: 10, marginTop: 2 }}>Already added</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
