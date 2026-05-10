import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { FsboListing } from '../../../api/types'

type SubView = 'listings' | 'import' | 'markets'

// Pre-configured target markets with median prices and Zillow FSBO search URLs
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

export function FsboPanel() {
  const [subView, setSubView] = useState<SubView>('listings')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { id: 'listings' as const, label: 'Listings' },
          { id: 'import' as const, label: 'Import Listings' },
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
      {subView === 'import' && <ImportView />}
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
                  background: '#22c55e15', color: '#22c55e', fontSize: 11, cursor: 'pointer',
                }}
              >
                Qualify {selectedIds.size}
              </button>
              <button
                onClick={() => bulkClassify.mutate('junk')}
                disabled={bulkClassify.isPending}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: '1px solid #ef444440',
                  background: '#ef444415', color: '#ef4444', fontSize: 11, cursor: 'pointer',
                }}
              >
                Junk {selectedIds.size}
              </button>
              <button
                onClick={() => ingestListings.mutate()}
                disabled={ingestListings.isPending}
                style={{
                  padding: '5px 12px', borderRadius: 5, border: 'none',
                  background: '#6366f1', color: '#fff', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Ingest {selectedIds.size}
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
          >&times;</button>
        </div>
      )}

      {/* Listing cards */}
      {(!listings || listings.length === 0) ? (
        <div style={{ color: '#555', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No FSBO listings found. Go to Import Listings to add data.
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
}: {
  listing: FsboListing
  selected: boolean
  expanded: boolean
  onToggleSelect: () => void
  onToggleExpand: () => void
  onClassify: (status: string) => void
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
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {lst.status !== 'qualified' && (
              <button
                onClick={() => onClassify('qualified')}
                title="Qualify"
                style={{
                  width: 28, height: 28, borderRadius: 4, border: '1px solid #22c55e30',
                  background: '#22c55e10', color: '#22c55e', fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                +
              </button>
            )}
            {lst.status !== 'junk' && (
              <button
                onClick={() => onClassify('junk')}
                title="Mark junk"
                style={{
                  width: 28, height: 28, borderRadius: 4, border: '1px solid #ef444430',
                  background: '#ef444410', color: '#ef4444', fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
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

/* ── Import View ───────────────────────────────────────────── */

function ImportView() {
  const queryClient = useQueryClient()
  const [pastedData, setPastedData] = useState('')
  const [parsedListings, setParsedListings] = useState<Record<string, string>[]>([])
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; scored: number } | null>(null)
  const [marketMetro, setMarketMetro] = useState('')
  const [marketState, setMarketState] = useState('OH')

  const importListings = useMutation({
    mutationFn: () =>
      hermesClient.fsbo.import({
        listings: parsedListings,
        market_metro: marketMetro || undefined,
        market_state: marketState || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['fsbo-listings'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-stats'] })
      queryClient.invalidateQueries({ queryKey: ['fsbo-markets'] })
      setImportResult(data)
      setPastedData('')
      setParsedListings([])
    },
  })

  function parseInput(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return []

    // Try CSV first
    const lines = trimmed.split('\n')
    if (lines.length >= 2 && lines[0].includes(',')) {
      return parseCsv(lines)
    }

    // Try structured listing blocks (Zillow copy-paste format)
    return parseListingBlocks(trimmed)
  }

  function parseCsv(lines: string[]): Record<string, string>[] {
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
    const rows: Record<string, string>[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      values.push(current.trim())

      const row: Record<string, string> = {}
      headers.forEach((h, idx) => {
        row[h] = values[idx] || ''
      })

      // Normalize header variations
      const normalized: Record<string, string> = {}
      for (const [k, v] of Object.entries(row)) {
        if (/address|location|street/i.test(k) && !normalized['address']) normalized['address'] = v
        else if (/asking.?price|price|list.?price/i.test(k) && !normalized['asking_price']) normalized['asking_price'] = v
        else if (/original.?price|starting.?price/i.test(k)) normalized['original_price'] = v
        else if (/zestimate/i.test(k)) normalized['zestimate'] = v
        else if (/days?.?on.?market|dom/i.test(k)) normalized['days_on_market'] = v
        else if (/price.?drop|price.?change|price.?reduction|drops/i.test(k)) normalized['price_drops'] = v
        else if (/bed|bedroom/i.test(k)) normalized['bedrooms'] = v
        else if (/bath|bathroom/i.test(k)) normalized['bathrooms'] = v
        else if (/sq\s*ft|sqft|square.?f/i.test(k)) normalized['sqft'] = v
        else if (/lot/i.test(k)) normalized['lot_sqft'] = v
        else if (/year.?built|built/i.test(k)) normalized['year_built'] = v
        else if (/photo|image/i.test(k)) normalized['photo_count'] = v
        else if (/desc/i.test(k)) normalized['description'] = v
        else if (/url|link|zillow/i.test(k)) normalized['zillow_url'] = v
        else if (/city/i.test(k)) normalized['city'] = v
        else if (/state/i.test(k)) normalized['state'] = v
        else if (/zip|postal/i.test(k)) normalized['zip'] = v
      }

      if (normalized['address']) rows.push(normalized)
    }
    return rows
  }

  function parseListingBlocks(text: string): Record<string, string>[] {
    // Parse Zillow-style listing blocks separated by blank lines
    // Pattern: address line, price line, details line (beds/baths/sqft), description
    const blocks = text.split(/\n\s*\n/)
    const results: Record<string, string>[] = []

    for (const block of blocks) {
      const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) continue

      const listing: Record<string, string> = {}

      for (const line of lines) {
        // Address: starts with a number
        if (/^\d+\s/.test(line) && !listing['address']) {
          // Could be "123 Main St, City, ST 12345" or just "123 Main St"
          const parts = line.split(',').map((p) => p.trim())
          listing['address'] = parts[0]
          if (parts.length >= 3) {
            listing['city'] = parts[1]
            const stateZip = parts[2].match(/([A-Z]{2})\s*(\d{5})?/)
            if (stateZip) {
              listing['state'] = stateZip[1]
              if (stateZip[2]) listing['zip'] = stateZip[2]
            }
          } else if (parts.length === 2) {
            const cityStateZip = parts[1].match(/(.+?)\s+([A-Z]{2})\s*(\d{5})?/)
            if (cityStateZip) {
              listing['city'] = cityStateZip[1].trim()
              listing['state'] = cityStateZip[2]
              if (cityStateZip[3]) listing['zip'] = cityStateZip[3]
            }
          }
          continue
        }

        // Price: starts with $ or contains price-like pattern
        const priceMatch = line.match(/\$[\d,]+/)
        if (priceMatch && !listing['asking_price']) {
          listing['asking_price'] = priceMatch[0].replace(/[$,]/g, '')

          // Check for "was $X" or "reduced from $X"
          const origMatch = line.match(/(?:was|from|original|reduced from)\s*\$([\d,]+)/i)
          if (origMatch) {
            listing['original_price'] = origMatch[1].replace(/,/g, '')
          }

          // Check for Zestimate in same line
          const zestMatch = line.match(/zestimate[:\s]*\$([\d,]+)/i)
          if (zestMatch) {
            listing['zestimate'] = zestMatch[1].replace(/,/g, '')
          }
          continue
        }

        // Beds/baths/sqft line: "3 bd | 2 ba | 1,500 sqft" or "3bd 2ba 1500sqft"
        const bedMatch = line.match(/(\d+\.?\d*)\s*(?:bd|bed|bedroom)/i)
        const bathMatch = line.match(/(\d+\.?\d*)\s*(?:ba|bath|bathroom)/i)
        const sqftMatch = line.match(/([\d,]+)\s*(?:sqft|sq\s*ft|square\s*f)/i)
        if (bedMatch || bathMatch || sqftMatch) {
          if (bedMatch) listing['bedrooms'] = bedMatch[1]
          if (bathMatch) listing['bathrooms'] = bathMatch[1]
          if (sqftMatch) listing['sqft'] = sqftMatch[1].replace(/,/g, '')
          continue
        }

        // DOM line
        const domMatch = line.match(/(\d+)\s*(?:days?\s*on\s*market|dom|days?\s*listed|days?\s*on\s*zillow)/i)
        if (domMatch) {
          listing['days_on_market'] = domMatch[1]
          continue
        }

        // Price drops
        const dropMatch = line.match(/(\d+)\s*(?:price\s*drop|price\s*change|reduction|cut)/i)
        if (dropMatch) {
          listing['price_drops'] = dropMatch[1]
          continue
        }

        // Zillow URL
        if (line.includes('zillow.com')) {
          const urlMatch = line.match(/(https?:\/\/www\.zillow\.com\/\S+)/)
          if (urlMatch) listing['zillow_url'] = urlMatch[1]
          continue
        }

        // Everything else could be description
        if (!listing['description'] && line.length > 20) {
          listing['description'] = line
        }
      }

      if (listing['address']) {
        results.push(listing)
      }
    }
    return results
  }

  return (
    <div>
      <div style={{
        background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
        padding: 16, marginBottom: 16,
      }}>
        <h4 style={{ color: '#e0e0e0', fontSize: 14, margin: '0 0 10px 0' }}>Import FSBO Listings</h4>

        {/* Market context */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
              Market (for median price scoring)
            </label>
            <select
              value={`${marketMetro}|${marketState}`}
              onChange={(e) => {
                const [m, s] = e.target.value.split('|')
                setMarketMetro(m)
                setMarketState(s)
              }}
              style={{
                padding: '6px 10px', borderRadius: 4, border: '1px solid #2a2a3e',
                background: '#0d0d14', color: '#ccc', fontSize: 12, minWidth: 200,
              }}
            >
              <option value="|">No market selected</option>
              {MARKET_PRESETS.map((p) => (
                <option key={`${p.metro}-${p.state}`} value={`${p.metro}|${p.state}`}>
                  {p.metro}, {p.state} (median: ${p.median_price.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {importResult && (
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 14,
            background: '#0f1f0f', border: '1px solid #1a3a1a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: '#4ade80', fontSize: 13 }}>
              Imported <strong>{importResult.imported}</strong> listings ({importResult.duplicates} duplicates, {importResult.scored} scored)
            </span>
            <button
              onClick={() => setImportResult(null)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
            >&times;</button>
          </div>
        )}

        <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
          Paste CSV data or Zillow listing blocks. The system auto-detects format and scores
          each listing for distress signals (DOM, price drops, below-median, keywords).
        </div>

        <textarea
          value={pastedData}
          onChange={(e) => {
            setPastedData(e.target.value)
            if (e.target.value.trim()) {
              setParsedListings(parseInput(e.target.value))
            } else {
              setParsedListings([])
            }
          }}
          placeholder={`Paste CSV or listing blocks here...

CSV format:
address,price,days_on_market,price_drops,zestimate,beds,baths,sqft,description,url
1234 Main St,$185000,95,2,$220000,3,1.5,1200,Must sell - relocating,https://zillow.com/...

Or listing blocks (separated by blank lines):
1234 Main St, Cleveland, OH 44109
$185,000 (was $210,000)
3 bd | 1.5 ba | 1,200 sqft
95 days on market, 2 price drops
Must sell - relocating out of state
https://www.zillow.com/homedetails/...`}
          style={{
            width: '100%', minHeight: 200, padding: 12, borderRadius: 6,
            border: '1px solid #2a2a3e', background: '#0d0d14', color: '#ccc',
            fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
          }}
        />

        {parsedListings.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 10 }}>
              Parsed {parsedListings.length} listing{parsedListings.length > 1 ? 's' : ''}
            </div>

            {/* Preview */}
            <div style={{
              maxHeight: 250, overflow: 'auto', border: '1px solid #1a1a2e',
              borderRadius: 6, marginBottom: 12,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#0d0d14' }}>
                    <th style={thStyle}>Address</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>DOM</th>
                    <th style={thStyle}>Drops</th>
                    <th style={thStyle}>Zestimate</th>
                    <th style={thStyle}>Beds/Baths</th>
                    <th style={thStyle}>Sqft</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedListings.slice(0, 15).map((lst, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111118' }}>
                      <td style={tdStyle}>{lst.address}</td>
                      <td style={tdStyle}>{lst.asking_price ? `$${Number(lst.asking_price).toLocaleString()}` : '-'}</td>
                      <td style={tdStyle}>{lst.days_on_market || '-'}</td>
                      <td style={tdStyle}>{lst.price_drops || '-'}</td>
                      <td style={tdStyle}>{lst.zestimate ? `$${Number(lst.zestimate).toLocaleString()}` : '-'}</td>
                      <td style={tdStyle}>{lst.bedrooms || '-'}/{lst.bathrooms || '-'}</td>
                      <td style={tdStyle}>{lst.sqft ? Number(lst.sqft).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedListings.length > 15 && (
                <div style={{ padding: 6, textAlign: 'center', color: '#555', fontSize: 10 }}>
                  ... and {parsedListings.length - 15} more
                </div>
              )}
            </div>

            <button
              onClick={() => importListings.mutate()}
              disabled={importListings.isPending}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: importListings.isPending ? '#333' : '#6366f1',
                color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {importListings.isPending ? 'Importing...' : `Import & Score ${parsedListings.length} Listings`}
            </button>
          </div>
        )}
      </div>

      {/* How-to guide */}
      <div style={{
        background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
        padding: 16,
      }}>
        <h4 style={{ color: '#aaa', fontSize: 13, margin: '0 0 10px 0' }}>How to Get FSBO Data from Zillow</h4>
        <ol style={{ color: '#666', fontSize: 12, lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
          <li>Go to zillow.com and search your target market</li>
          <li>Click "Listing Type" filter, select only "For Sale by Owner"</li>
          <li>Sort by "Newest" or "Days on Zillow" to find stale listings</li>
          <li>For each listing, note: address, price, DOM, price history (drops), Zestimate, bed/bath/sqft</li>
          <li>Check the description for distress keywords: "must sell", "as-is", "estate", "relocating"</li>
          <li>Paste into the text area above as CSV or listing blocks</li>
        </ol>

        <h4 style={{ color: '#aaa', fontSize: 13, margin: '16px 0 8px 0' }}>What the Distress Score Measures</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', fontSize: 11, color: '#666' }}>
          <div>90+ days on market: <span style={{ color: '#ef4444' }}>+20-30 pts</span></div>
          <div>2+ price drops: <span style={{ color: '#ef4444' }}>+15-20 pts</span></div>
          <div>10%+ below original: <span style={{ color: '#f59e0b' }}>+10-15 pts</span></div>
          <div>Below median price: <span style={{ color: '#f59e0b' }}>+5-15 pts</span></div>
          <div>Below Zestimate: <span style={{ color: '#eab308' }}>+5-15 pts</span></div>
          <div>Low photo count: <span style={{ color: '#888' }}>+3-8 pts</span></div>
          <div>Distress keywords: <span style={{ color: '#f59e0b' }}>+5-15 pts</span></div>
          <div>Score 40+ = auto-qualified</div>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px', color: '#888', textAlign: 'left',
  borderBottom: '1px solid #1a1a2e', fontSize: 10, fontWeight: 600,
}
const tdStyle: React.CSSProperties = {
  padding: '5px 8px', color: '#ccc',
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
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11,
                      border: `1px solid ${m.active ? '#ef444430' : '#22c55e30'}`,
                      background: m.active ? '#ef444410' : '#22c55e10',
                      color: m.active ? '#ef4444' : '#22c55e',
                      cursor: 'pointer',
                    }}
                  >
                    {m.active ? 'Disable' : 'Enable'}
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
