import { useState, useMemo } from 'react'
import { BUYERS } from '../buyer-data'
import type { Buyer, BuyerType } from '../buyer-data'

type StateFilter = 'all' | 'OH' | 'TX'
type TierFilter = 'all' | '1' | '2'
type TypeFilter = 'all' | 'cash' | 'jv'

const MARKETS = Array.from(new Set(BUYERS.map(b => b.market))).sort()

export function BuyerDirectory() {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [marketFilter, setMarketFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    return BUYERS.filter(b => {
      if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter !== 'all' && b.state !== stateFilter && b.state !== 'BOTH') return false
      if (tierFilter !== 'all' && b.tier !== Number(tierFilter)) return false
      if (typeFilter !== 'all' && b.type !== typeFilter) return false
      if (marketFilter !== 'all' && b.market !== marketFilter) return false
      return true
    })
  }, [search, stateFilter, tierFilter, typeFilter, marketFilter])

  const cashCount = filtered.filter(b => b.type === 'cash').length
  const jvCount = filtered.filter(b => b.type === 'jv').length

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <input
          type="text"
          placeholder="Search buyers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: '9px 14px',
            color: '#e2e8f0', fontSize: 13, outline: 'none',
            width: 200,
          }}
        />
        <FilterSelect value={stateFilter} onChange={v => setStateFilter(v as StateFilter)}
          options={[['all', 'All States'], ['OH', 'Ohio'], ['TX', 'Texas']]} />
        <FilterSelect value={typeFilter} onChange={v => setTypeFilter(v as TypeFilter)}
          options={[['all', 'All Types'], ['cash', 'Cash Buyers'], ['jv', 'JV Partners']]} />
        <FilterSelect value={tierFilter} onChange={v => setTierFilter(v as TierFilter)}
          options={[['all', 'All Tiers'], ['1', 'Tier 1'], ['2', 'Tier 2']]} />
        <FilterSelect value={marketFilter} onChange={v => setMarketFilter(v)}
          options={[['all', 'All Markets'], ...MARKETS.map(m => [m, m])]} />
      </div>

      {/* Summary */}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        <span style={{ color: '#c7d2fe', fontWeight: 600 }}>{filtered.length}</span> buyers
        {' · '}
        <span style={{ color: '#818cf8' }}>{cashCount}</span> cash
        {' · '}
        <span style={{ color: '#f59e0b' }}>{jvCount}</span> JV
      </div>

      {/* Buyer cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {filtered.map(buyer => (
          <BuyerCard key={buyer.name} buyer={buyer} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#475569', fontSize: 13 }}>
          No buyers match your filters.
        </div>
      )}
    </div>
  )
}

function BuyerCard({ buyer }: { buyer: Buyer }) {
  const isJv = buyer.type === 'jv'
  const borderColor = isJv ? 'rgba(245,158,11,0.15)' : buyer.tier === 1 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)'

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${borderColor}`,
      borderRadius: 14,
      padding: '18px 20px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', flex: 1, minWidth: 0 }}>
          {buyer.name}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: isJv ? '#f59e0b' : buyer.tier === 1 ? '#818cf8' : '#64748b',
            background: isJv ? 'rgba(245,158,11,0.12)' : buyer.tier === 1 ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.06)',
            padding: '3px 8px', borderRadius: 5,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {isJv ? 'JV Partner' : `Tier ${buyer.tier}`}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: '#94a3b8',
            background: 'rgba(255,255,255,0.04)',
            padding: '3px 8px', borderRadius: 5,
          }}>
            {buyer.state}
          </span>
        </div>
      </div>

      {/* Contact info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
        {buyer.phone && <div style={{ fontSize: 12, color: '#94a3b8' }}>{buyer.phone}</div>}
        {buyer.email && <div style={{ fontSize: 11, color: '#64748b' }}>{buyer.email}</div>}
        {buyer.website && <div style={{ fontSize: 11, color: '#6366f1' }}>{buyer.website}</div>}
      </div>

      {/* Buy box */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Buys</div>
        <div style={{ fontSize: 12, color: '#c7d2fe', lineHeight: 1.4 }}>{buyer.buys}</div>
      </div>

      {/* Model */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Model</div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{buyer.model}</div>
      </div>

      {/* Counties */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: buyer.evidence ? 10 : 0 }}>
        {buyer.counties.map(c => (
          <span key={c} style={{
            fontSize: 10, color: '#64748b',
            background: 'rgba(255,255,255,0.04)',
            padding: '3px 8px', borderRadius: 5,
          }}>
            {c}
          </span>
        ))}
      </div>

      {/* Evidence */}
      {buyer.evidence && (
        <div style={{
          fontSize: 11, color: '#22c55e', fontStyle: 'italic',
          background: 'rgba(34,197,94,0.06)',
          padding: '8px 12px', borderRadius: 8, marginTop: 10,
        }}>
          {buyer.evidence}
        </div>
      )}

      {/* Tags */}
      {buyer.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
          {buyer.tags.map(tag => {
            const color = tag === 'priority' ? '#818cf8'
              : tag === 'jv-partner' ? '#f59e0b'
              : tag === 'transactional-funder' ? '#22c55e'
              : tag === 'funds-emd' ? '#22c55e'
              : tag === 'buyer-network' ? '#06b6d4'
              : '#64748b'
            return (
              <span key={tag} style={{
                fontSize: 9, fontWeight: 600, color,
                background: `${color}15`,
                padding: '2px 7px', borderRadius: 4,
              }}>
                {tag}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[][]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, padding: '9px 12px',
        color: '#e2e8f0', fontSize: 12, cursor: 'pointer',
        outline: 'none', appearance: 'auto',
      }}
    >
      {options.map(([val, label]) => (
        <option key={val} value={val} style={{ background: '#0f0f19', color: '#e2e8f0' }}>
          {label}
        </option>
      ))}
    </select>
  )
}
