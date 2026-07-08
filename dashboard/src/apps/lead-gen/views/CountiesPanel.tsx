import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'

type SortKey = 'scouted_score' | 'static_score' | 'total_distressed' | 'population' | 'median_home_value'

export function CountiesPanel() {
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = useState<SortKey>('scouted_score')

  const stats = useQuery({ queryKey: ['county-stats'], queryFn: hermesClient.counties.stats, refetchInterval: 10_000 })
  const scoutStatus = useQuery({ queryKey: ['scout-status'], queryFn: hermesClient.counties.scoutStatus, refetchInterval: 3_000 })
  const topCounties = useQuery({ queryKey: ['counties-top'], queryFn: () => hermesClient.counties.list({ limit: 100 }), refetchInterval: 15_000 })

  const seedMut = useMutation({
    mutationFn: hermesClient.counties.seed,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['county-stats'] }); queryClient.invalidateQueries({ queryKey: ['counties-top'] }) },
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
  const counties = topCounties.data ?? []

  const sorted = [...counties].sort((a, b) => {
    const av = a[sortBy] ?? a.static_score
    const bv = b[sortBy] ?? b.static_score
    return (bv ?? 0) - (av ?? 0)
  })

  return (
    <div>
      {/* Stats Header */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total Counties" value={s?.total ?? '–'} />
        <StatCard label="Eligible" value={s?.eligible ?? '–'} />
        <StatCard label="Scouted" value={s?.scouted ?? '–'} />
        <StatCard label="Harvested" value={s?.harvested ?? '–'} />
        {s && s.eligible > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 120, height: 8, background: 'rgba(99,102,241,0.12)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(((s.scouted || 0) / s.eligible) * 100)}%`, height: '100%', background: '#22c55e', borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {Math.round(((s.scouted || 0) / s.eligible) * 100)}% scouted
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {s?.total === 0 && (
          <ActionButton
            label={seedMut.isPending ? 'Seeding...' : 'Seed Counties (Census Data)'}
            onClick={() => seedMut.mutate()}
            disabled={seedMut.isPending}
            color="#6366f1"
          />
        )}
        <ActionButton
          label={scoutMut.isPending ? 'Starting...' : scout?.running ? 'Scouting...' : 'Scout Next 50'}
          onClick={() => scoutMut.mutate(50)}
          disabled={scoutMut.isPending || scout?.running}
          color="#22c55e"
        />
        <ActionButton
          label={harvestMut.isPending ? 'Starting...' : 'Harvest Top 10'}
          onClick={() => harvestMut.mutate({ batchSize: 10, signal: 'pre_foreclosure' })}
          disabled={harvestMut.isPending}
          color="#f59e0b"
        />
      </div>

      {/* Scout Log Panel */}
      {scout?.running && <LogPanel lines={scout.log_lines} phase={scout.phase} />}

      {/* County Table */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {([
            { key: 'scouted_score' as const, label: 'Score' },
            { key: 'total_distressed' as const, label: 'Distressed' },
            { key: 'population' as const, label: 'Population' },
            { key: 'median_home_value' as const, label: 'Home Value' },
          ]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${sortBy === s.key ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                background: sortBy === s.key ? '#6366f120' : 'transparent',
                color: sortBy === s.key ? '#818cf8' : '#666',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e', color: '#64748b' }}>
                <th style={th}>#</th>
                <th style={th}>County</th>
                <th style={th}>State</th>
                <th style={{ ...th, textAlign: 'right' }}>Population</th>
                <th style={{ ...th, textAlign: 'right' }}>Median Value</th>
                <th style={{ ...th, textAlign: 'right' }}>PreFC</th>
                <th style={{ ...th, textAlign: 'right' }}>Tax Del.</th>
                <th style={{ ...th, textAlign: 'right' }}>Probate</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}>Score</th>
                <th style={th}>Tier</th>
                <th style={th}>Scouted</th>
                <th style={th}>Harvested</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => (
                <tr key={c.fips} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>{c.county}</td>
                  <td style={td}>{c.state}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{c.population?.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right' }}>${c.median_home_value?.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{c.pre_foreclosure_count?.toLocaleString() ?? '–'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{c.tax_delinquent_count?.toLocaleString() ?? '–'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{c.probate_count?.toLocaleString() ?? '–'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: (c.total_distressed ?? 0) > 200 ? '#22c55e' : '#ccc' }}>
                    {c.total_distressed?.toLocaleString() ?? '–'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: scoreColor(c.scouted_score ?? c.static_score) }}>
                    {c.scouted_score ?? c.static_score}
                  </td>
                  <td style={td}>
                    <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, background: tierBg(c.regulatory_tier), color: tierFg(c.regulatory_tier) }}>
                      {c.regulatory_tier}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#64748b' }}>{c.scouted_at ? new Date(c.scouted_at).toLocaleDateString() : '–'}</td>
                  <td style={{ ...td, color: '#64748b' }}>{c.last_harvested_at ? new Date(c.last_harvested_at).toLocaleDateString() : '–'}</td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={13} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 24 }}>
                    {s?.total === 0 ? 'Click "Seed Counties" to load Census data' : 'No counties match current filter'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#12121e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '10px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  )
}

function ActionButton({ label, onClick, disabled, color }: { label: string; onClick: () => void; disabled?: boolean; color: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${color}`, background: `${color}20`, color,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

function LogPanel({ lines, phase }: { lines: string[]; phase: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [lines.length])

  return (
    <div style={{ background: '#0a0a14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Scout Pipeline</span>
        <span style={{ fontSize: 10, color: '#64748b' }}>{phase}</span>
      </div>
      <div ref={ref} style={{ maxHeight: 200, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ padding: '1px 0' }}>{line}</div>
        ))}
      </div>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 60) return '#22c55e'
  if (score >= 40) return '#f59e0b'
  if (score >= 20) return '#eab308'
  return '#666'
}

function tierBg(tier: string): string {
  if (tier === 'green') return '#22c55e20'
  if (tier === 'high_friction') return '#f59e0b20'
  return '#ef444420'
}

function tierFg(tier: string): string {
  if (tier === 'green') return '#22c55e'
  if (tier === 'high_friction') return '#f59e0b'
  return '#ef4444'
}

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }
const td: React.CSSProperties = { padding: '6px 8px', color: '#e2e8f0' }
