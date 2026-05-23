import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'

type SortKey = 'score' | 'total_distressed' | 'population' | 'median_home_value'
type TierFilter = 'all' | 'hot' | 'warm' | 'lukewarm' | 'cold'

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 50) return '#eab308'
  if (score >= 30) return '#f97316'
  return '#ef4444'
}

function scoreTier(score: number): { label: string; color: string } {
  if (score >= 70) return { label: 'HOT', color: '#22c55e' }
  if (score >= 50) return { label: 'WARM', color: '#eab308' }
  if (score >= 30) return { label: 'LUKEWARM', color: '#f97316' }
  return { label: 'COLD', color: '#ef4444' }
}


function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return n.toLocaleString()
}

export function MarketSelector() {
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = useState<SortKey>('score')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [stateFilter, setStateFilter] = useState<string>('')

  const stats = useQuery({ queryKey: ['county-stats'], queryFn: hermesClient.counties.stats, refetchInterval: 10_000 })
  const countiesQ = useQuery({ queryKey: ['counties-list'], queryFn: () => hermesClient.counties.list({ limit: 200, scouted_only: true }), refetchInterval: 15_000 })
  const scoutStatus = useQuery({ queryKey: ['scout-status'], queryFn: hermesClient.counties.scoutStatus, refetchInterval: 3_000 })

  const seedMut = useMutation({
    mutationFn: hermesClient.counties.seed,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['county-stats'] }); queryClient.invalidateQueries({ queryKey: ['counties-list'] }) },
  })
  const scoutMut = useMutation({
    mutationFn: (batchSize: number) => hermesClient.counties.scout(batchSize),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scout-status'] }),
  })
  const harvestMut = useMutation({
    mutationFn: ({ batchSize, signal }: { batchSize: number; signal: string }) => hermesClient.counties.harvest(batchSize, signal),
  })

  const s = stats.data
  const scout = scoutStatus.data
  const counties = countiesQ.data ?? []

  const tierCounts = useMemo(() => {
    const counts = { hot: 0, warm: 0, lukewarm: 0, cold: 0 }
    for (const c of counties) {
      const score = c.scouted_score ?? c.static_score
      if (score >= 70) counts.hot++
      else if (score >= 50) counts.warm++
      else if (score >= 30) counts.lukewarm++
      else counts.cold++
    }
    return counts
  }, [counties])

  const totalDistressed = useMemo(() => counties.reduce((sum, c) => sum + (c.total_distressed ?? 0), 0), [counties])

  const topSignals = useMemo(() => {
    const prefc = counties.reduce((sum, c) => sum + (c.pre_foreclosure_count ?? 0), 0)
    const taxdel = counties.reduce((sum, c) => sum + (c.tax_delinquent_count ?? 0), 0)
    const probate = counties.reduce((sum, c) => sum + (c.probate_count ?? 0), 0)
    return { prefc, taxdel, probate }
  }, [counties])

  const filtered = useMemo(() => {
    let list = counties
    if (stateFilter) list = list.filter(c => c.state === stateFilter)
    if (tierFilter !== 'all') {
      list = list.filter(c => {
        const score = c.scouted_score ?? c.static_score
        if (tierFilter === 'hot') return score >= 70
        if (tierFilter === 'warm') return score >= 50 && score < 70
        if (tierFilter === 'lukewarm') return score >= 30 && score < 50
        return score < 30
      })
    }
    return list
  }, [counties, stateFilter, tierFilter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return ((b.scouted_score ?? b.static_score) - (a.scouted_score ?? a.static_score))
      if (sortBy === 'total_distressed') return ((b.total_distressed ?? 0) - (a.total_distressed ?? 0))
      if (sortBy === 'population') return (b.population - a.population)
      if (sortBy === 'median_home_value') return (a.median_home_value - b.median_home_value)
      return 0
    })
  }, [filtered, sortBy])

  const uniqueStates = [...new Set(counties.map(c => c.state))].sort()
  const notSeeded = s?.total === 0

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: '#e0e0e0', fontSize: 20, margin: '0 0 6px' }}>Market Intelligence</h2>
        <p style={{ color: '#666', fontSize: 13, margin: 0 }}>
          Nationwide market ranking — {s?.scouted ?? 0} of {s?.eligible ?? 0} eligible counties scouted via PropStream.
          Ranked by distress density, price sweet spot, and population.
        </p>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 20 }}>
        <SummaryCard label="Counties Scouted" value={s?.scouted ?? 0} color="#6366f1" sub={`of ${s?.eligible ?? 0} eligible`} />
        <SummaryCard label="Total Distressed" value={totalDistressed ? fmt(totalDistressed) : '–'} color="#ef4444" sub="across scouted counties" />
        <SummaryCard label="Pre-Foreclosure" value={topSignals.prefc ? fmt(topSignals.prefc) : '–'} color="#f97316" />
        <SummaryCard label="Tax Delinquent" value={topSignals.taxdel ? fmt(topSignals.taxdel) : '–'} color="#eab308" />
        <SummaryCard label="Probate" value={topSignals.probate ? fmt(topSignals.probate) : '–'} color="#8b5cf6" />
        <SummaryCard label="Harvested" value={s?.harvested ?? 0} color="#22c55e" sub="leads generated" />
      </div>

      {/* Tier breakdown */}
      {counties.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'stretch' }}>
          <TierCard tier="HOT" count={tierCounts.hot} color="#22c55e" desc="Score 70+" active={tierFilter === 'hot'} onClick={() => setTierFilter(tierFilter === 'hot' ? 'all' : 'hot')} />
          <TierCard tier="WARM" count={tierCounts.warm} color="#eab308" desc="Score 50-69" active={tierFilter === 'warm'} onClick={() => setTierFilter(tierFilter === 'warm' ? 'all' : 'warm')} />
          <TierCard tier="LUKEWARM" count={tierCounts.lukewarm} color="#f97316" desc="Score 30-49" active={tierFilter === 'lukewarm'} onClick={() => setTierFilter(tierFilter === 'lukewarm' ? 'all' : 'lukewarm')} />
          <TierCard tier="COLD" count={tierCounts.cold} color="#ef4444" desc="Score <30" active={tierFilter === 'cold'} onClick={() => setTierFilter(tierFilter === 'cold' ? 'all' : 'cold')} />
        </div>
      )}

      {/* Progress bar */}
      {s && s.eligible > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(((s.scouted || 0) / s.eligible) * 100)}%`, height: '100%', background: '#22c55e', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
            {Math.round(((s.scouted || 0) / s.eligible) * 100)}% coverage
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {notSeeded && (
          <ActionBtn color="#6366f1" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            {seedMut.isPending ? 'Seeding...' : 'Seed 3,143 Counties'}
          </ActionBtn>
        )}
        <ActionBtn color="#22c55e" onClick={() => scoutMut.mutate(50)} disabled={scoutMut.isPending || scout?.running}>
          {scoutMut.isPending ? 'Starting...' : scout?.running ? 'Scouting...' : 'Scout Next 50'}
        </ActionBtn>
        <ActionBtn color="#f59e0b" onClick={() => harvestMut.mutate({ batchSize: 10, signal: 'pre_foreclosure' })} disabled={harvestMut.isPending}>
          {harvestMut.isPending ? 'Starting...' : 'Harvest Top 10'}
        </ActionBtn>
      </div>

      {/* Scout log */}
      {scout?.running && <LogPanel lines={scout.log_lines} phase={scout.phase} />}

      {/* Filters & Sort */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#666' }}>Sort:</span>
        {([
          { key: 'score' as const, label: 'Score' },
          { key: 'total_distressed' as const, label: 'Distressed' },
          { key: 'population' as const, label: 'Population' },
          { key: 'median_home_value' as const, label: 'Cheapest' },
        ]).map((s) => (
          <TabBtn key={s.key} active={sortBy === s.key} onClick={() => setSortBy(s.key)}>{s.label}</TabBtn>
        ))}
        <span style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>State:</span>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          style={{ background: '#1a1a2e', color: '#ccc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', fontSize: 11 }}
        >
          <option value="">All ({counties.length})</option>
          {uniqueStates.map(st => (
            <option key={st} value={st}>{st} ({counties.filter(c => c.state === st).length})</option>
          ))}
        </select>
        {tierFilter !== 'all' && (
          <button onClick={() => setTierFilter('all')} style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Clear tier filter
          </button>
        )}
      </div>

      {/* County table */}
      <div style={{ borderRadius: 8, border: '1px solid #1e1e2e', overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 1.6fr 0.5fr 0.5fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr 0.7fr',
          padding: '10px 12px',
          background: '#0a0a12',
          borderBottom: '1px solid #2a2a3e',
        }}>
          {['#', 'County', 'State', 'Tier', 'Score', 'Median', 'Pop.', 'PreFC', 'Tax Del.', 'Probate', 'Total'].map((h) => (
            <span key={h} style={{
              fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
              textAlign: ['#', 'County', 'State', 'Tier'].includes(h) ? 'left' : 'right',
            }}>{h}</span>
          ))}
        </div>
        {sorted.slice(0, 100).map((c, i) => {
          const score = c.scouted_score ?? c.static_score
          const tier = scoreTier(score)
          const sc = scoreColor(score)
          return (
            <div key={c.fips} style={{
              display: 'grid',
              gridTemplateColumns: '36px 1.6fr 0.5fr 0.5fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr 0.7fr',
              alignItems: 'center',
              padding: '10px 12px',
              background: i % 2 === 0 ? '#111118' : '#0d0d14',
              borderBottom: '1px solid #1a1a2e',
            }}>
              <span style={{ color: '#555', fontSize: 12, fontWeight: 600 }}>{i + 1}</span>
              <div>
                <span style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600 }}>{c.county}</span>
                {c.last_harvested_at && <span style={{ marginLeft: 4, fontSize: 8, color: '#f59e0b', background: '#f59e0b20', padding: '1px 4px', borderRadius: 2 }}>HARVESTED</span>}
              </div>
              <span style={{ color: '#999', fontSize: 12 }}>{c.state}</span>
              <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: tier.color + '20', color: tier.color }}>
                {tier.label}
              </span>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', minWidth: 30, padding: '2px 6px', borderRadius: 4,
                  fontSize: 12, fontWeight: 700, color: sc, background: sc + '18', textAlign: 'center',
                }}>
                  {score}
                </span>
              </div>
              <span style={{ color: '#ccc', fontSize: 11, textAlign: 'right' }}>
                {c.median_home_value ? `$${fmt(c.median_home_value)}` : '–'}
              </span>
              <span style={{ color: '#ccc', fontSize: 11, textAlign: 'right' }}>{fmt(c.population)}</span>
              <span style={{ color: (c.pre_foreclosure_count ?? 0) > 1000 ? '#f97316' : '#888', fontSize: 11, textAlign: 'right', fontWeight: (c.pre_foreclosure_count ?? 0) > 1000 ? 600 : 400 }}>
                {c.pre_foreclosure_count != null ? fmt(c.pre_foreclosure_count) : '–'}
              </span>
              <span style={{ color: (c.tax_delinquent_count ?? 0) > 1000 ? '#eab308' : '#888', fontSize: 11, textAlign: 'right', fontWeight: (c.tax_delinquent_count ?? 0) > 1000 ? 600 : 400 }}>
                {c.tax_delinquent_count != null ? fmt(c.tax_delinquent_count) : '–'}
              </span>
              <span style={{ color: (c.probate_count ?? 0) > 500 ? '#8b5cf6' : '#888', fontSize: 11, textAlign: 'right', fontWeight: (c.probate_count ?? 0) > 500 ? 600 : 400 }}>
                {c.probate_count != null ? fmt(c.probate_count) : '–'}
              </span>
              <span style={{
                color: (c.total_distressed ?? 0) > 10000 ? '#22c55e' : '#ccc',
                fontSize: 11, fontWeight: (c.total_distressed ?? 0) > 10000 ? 700 : 400, textAlign: 'right',
              }}>
                {c.total_distressed != null ? fmt(c.total_distressed) : '–'}
              </span>
            </div>
          )
        })}
        {!sorted.length && (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>
            {notSeeded ? 'Click "Seed 3,143 Counties" to load Census data and start scouting.' : counties.length === 0 ? 'No scouted counties yet. Click "Scout Next 50" to begin.' : 'No counties match current filter.'}
          </div>
        )}
      </div>

      {/* Blocked states notice */}
      <div style={{ marginTop: 16, padding: 12, background: '#1a1a2e', borderRadius: 8, border: '1px solid #2a2a3e' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>Blocked States (9)</div>
        <div style={{ fontSize: 11, color: '#666' }}>
          SC, IL, OK, KY, PA, VA, NC, NE, NY — wholesaling effectively banned, all leads auto-rejected.
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', marginTop: 8, marginBottom: 4 }}>High-Friction States (12)</div>
        <div style={{ fontSize: 11, color: '#666' }}>
          CT, OR, MD, AZ, CA, IA, TN, IN, WI, ND, AL, OH — workable with care, -10 score penalty applied.
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#444' }}>
          Score = distress density (35) + price sweet spot (25) + population (15) + signal diversity (9) - friction (10)
        </span>
      </div>
    </div>
  )
}

function TierCard({ tier, count, color, desc, active, onClick }: { tier: string; count: number; color: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: active ? color + '15' : '#111118', border: `1px solid ${active ? color : '#1e1e2e'}`,
      borderRadius: 8, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5 }}>{tier}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color }}>{count}</span>
      </div>
      <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{desc}</div>
    </button>
  )
}

function LogPanel({ lines, phase }: { lines: string[]; phase: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [lines.length])
  return (
    <div style={{ background: '#0a0a14', border: '1px solid #2a2a3e', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Scout Pipeline</span>
        <span style={{ fontSize: 10, color: '#666' }}>{phase}</span>
      </div>
      <div ref={ref} style={{ maxHeight: 200, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
        {lines.map((line, i) => <div key={i} style={{ padding: '1px 0' }}>{line}</div>)}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
      border: `1px solid ${active ? '#6366f1' : '#2a2a3e'}`,
      background: active ? '#6366f120' : 'transparent',
      color: active ? '#818cf8' : '#666',
    }}>{children}</button>
  )
}

function ActionBtn({ color, onClick, disabled, children }: { color: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      border: `1px solid ${color}`, background: `${color}20`, color,
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  )
}
