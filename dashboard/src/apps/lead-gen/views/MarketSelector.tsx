import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { MarketInfo } from '../../../api/types'

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 50) return '#eab308'
  if (score >= 30) return '#f97316'
  return '#ef4444'
}

function MarketRow({ market, rank }: { market: MarketInfo; rank: number }) {
  const sc = scoreColor(market.score)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px 1.4fr 0.6fr 0.8fr 0.8fr 0.7fr 0.7fr 0.8fr',
      alignItems: 'center',
      padding: '12px 16px',
      background: rank % 2 === 0 ? '#111118' : '#0d0d14',
      borderBottom: '1px solid #1a1a2e',
    }}>
      <span style={{ color: '#555', fontSize: 12, fontWeight: 600 }}>{rank}</span>
      <div>
        <span style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{market.metro}</span>
        <span style={{ color: '#555', fontSize: 12, marginLeft: 6 }}>{market.state}</span>
        {market.high_friction && (
          <span style={{ marginLeft: 6, fontSize: 9, color: '#f97316', background: '#f9731615', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
            HI-FRICTION
          </span>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-block', minWidth: 36, padding: '3px 8px', borderRadius: 4,
          fontSize: 13, fontWeight: 700, color: sc, background: sc + '18', textAlign: 'center',
        }}>
          {market.score}
        </span>
      </div>
      <span style={{ color: '#ccc', fontSize: 12, textAlign: 'right' }}>
        ${(market.median_price / 1000).toFixed(0)}k
      </span>
      <span style={{ color: '#ccc', fontSize: 12, textAlign: 'right' }}>
        {(market.population / 1_000_000).toFixed(1)}M
      </span>
      <span style={{ color: market.cash_buyer_pct >= 0.28 ? '#22c55e' : '#aaa', fontSize: 12, textAlign: 'right' }}>
        {(market.cash_buyer_pct * 100).toFixed(0)}%
      </span>
      <div style={{ textAlign: 'center' }}>
        {market.has_code_portal ? (
          <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>LIVE</span>
        ) : (
          <span style={{ color: '#444', fontSize: 11 }}>—</span>
        )}
      </div>
      <span style={{
        color: market.lead_count > 0 ? '#6366f1' : '#333',
        fontSize: 12, fontWeight: market.lead_count > 0 ? 600 : 400, textAlign: 'right',
      }}>
        {market.lead_count > 0 ? market.lead_count.toLocaleString() : '—'}
      </span>
    </div>
  )
}

export function MarketSelector() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['markets'],
    queryFn: hermesClient.markets.list,
    staleTime: 60_000,
  })

  const markets = data?.markets || []
  const withPortal = markets.filter((m) => m.has_code_portal)
  const withLeads = markets.filter((m) => m.lead_count > 0)

  if (isLoading) return <div style={{ color: '#666' }}>Loading markets...</div>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: '#e0e0e0', fontSize: 20, margin: '0 0 6px' }}>Market Selector</h2>
        <p style={{ color: '#666', fontSize: 13, margin: 0 }}>
          Ranked by wholesaling viability — price point, cash buyers, investor demand, and data availability.
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <SummaryCard label="Markets Analyzed" value={String(markets.length)} color="#6366f1" />
        <SummaryCard label="Live Portals" value={String(withPortal.length)} color="#22c55e" />
        <SummaryCard label="Active Markets" value={String(withLeads.length)} color="#8b5cf6" />
        <SummaryCard
          label="Top Score"
          value={markets.length > 0 ? String(markets[0].score) : '—'}
          color="#eab308"
          sub={markets.length > 0 ? markets[0].metro : ''}
        />
      </div>

      {error && (
        <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8, border: '1px solid #2a2a3e', color: '#888', marginBottom: 16 }}>
          Connect to Hermes to load market data.
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius: 8, border: '1px solid #1e1e2e', overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 1.4fr 0.6fr 0.8fr 0.8fr 0.7fr 0.7fr 0.8fr',
          padding: '10px 16px',
          background: '#0a0a12',
          borderBottom: '1px solid #2a2a3e',
        }}>
          {['#', 'Metro', 'Score', 'Median', 'Pop.', 'Cash %', 'Portal', 'Leads'].map((h) => (
            <span key={h} style={{
              fontSize: 10, color: '#555', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.5,
              textAlign: ['#', 'Metro'].includes(h) ? 'left' : ['Score', 'Portal'].includes(h) ? 'center' : 'right',
            }}>{h}</span>
          ))}
        </div>
        {markets.map((m, i) => (
          <MarketRow key={m.metro} market={m} rank={i + 1} />
        ))}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <LegendItem color="#22c55e" label="70+ Excellent" />
        <LegendItem color="#eab308" label="50-69 Good" />
        <LegendItem color="#f97316" label="30-49 Fair" />
        <LegendItem color="#ef4444" label="<30 Weak" />
        <span style={{ fontSize: 11, color: '#444' }}>
          Score = price sweet spot + cash buyers + population + portal availability - friction
        </span>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11, color: '#666' }}>{label}</span>
    </div>
  )
}
