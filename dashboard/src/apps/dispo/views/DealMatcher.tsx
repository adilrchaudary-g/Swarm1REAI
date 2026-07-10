import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import { BUYERS, getCountyForCity } from '../buyer-data'
import type { Lead } from '../../../api/types'
import type { Buyer } from '../buyer-data'

type StatusFilter = 'all' | 'interested' | 'underwriting' | 'under_contract'

const STATUS_COLORS: Record<string, string> = {
  interested: '#818cf8',
  underwriting: '#f59e0b',
  under_contract: '#22c55e',
}

export function DealMatcher() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const interested = useQuery({
    queryKey: ['dispo-leads', 'interested'],
    queryFn: () => hermesClient.leads.list({ status: 'interested', limit: 500 }),
    staleTime: 30_000,
  })
  const underwriting = useQuery({
    queryKey: ['dispo-leads', 'underwriting'],
    queryFn: () => hermesClient.leads.list({ status: 'underwriting', limit: 500 }),
    staleTime: 30_000,
  })
  const underContract = useQuery({
    queryKey: ['dispo-leads', 'under_contract'],
    queryFn: () => hermesClient.leads.list({ status: 'under_contract', limit: 500 }),
    staleTime: 30_000,
  })

  const loading = interested.isLoading || underwriting.isLoading || underContract.isLoading

  const allLeads = useMemo(() => {
    const tagged = (leads: Lead[] | undefined, status: string) =>
      (leads || []).map(l => ({ ...l, _dispo_status: status }))
    return [
      ...tagged(interested.data, 'interested'),
      ...tagged(underwriting.data, 'underwriting'),
      ...tagged(underContract.data, 'under_contract'),
    ]
  }, [interested.data, underwriting.data, underContract.data])

  const filtered = statusFilter === 'all' ? allLeads : allLeads.filter(l => (l as any)._dispo_status === statusFilter)

  const matched = useMemo(() => {
    return filtered.map(lead => {
      const county = lead.address_city && lead.address_state
        ? getCountyForCity(lead.address_city, lead.address_state) : null
      const matchedBuyers = county
        ? BUYERS.filter(b => b.counties.includes(county) && (b.state === lead.address_state || b.state === 'BOTH'))
        : []
      return { lead, county, cashBuyers: matchedBuyers.filter(b => b.type === 'cash'), jvPartners: matchedBuyers.filter(b => b.type === 'jv') }
    })
  }, [filtered])

  const statuses: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: `All (${allLeads.length})` },
    { id: 'interested', label: `Interested (${interested.data?.length || 0})` },
    { id: 'underwriting', label: `Underwriting (${underwriting.data?.length || 0})` },
    { id: 'under_contract', label: `Under Contract (${underContract.data?.length || 0})` },
  ]

  if (loading) {
    return <div style={{ color: '#475569', fontSize: 13, padding: 40, textAlign: 'center' }}>Loading dispo pipeline...</div>
  }

  if (allLeads.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 20px', color: '#475569',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>No dispo-ready leads</div>
        <div style={{ fontSize: 13 }}>Leads move here when they reach Interested, Underwriting, or Under Contract status.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Status filter */}
      <div style={{
        display: 'inline-flex', gap: 4, marginBottom: 20,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 12, padding: 3,
      }}>
        {statuses.map(s => (
          <button key={s.id} onClick={() => setStatusFilter(s.id)} style={{
            padding: '7px 14px', borderRadius: 9, fontSize: 12, cursor: 'pointer',
            border: statusFilter === s.id ? '1px solid rgba(99,102,241,0.3)' : 'none',
            background: statusFilter === s.id ? 'rgba(99,102,241,0.12)' : 'transparent',
            color: statusFilter === s.id ? '#c7d2fe' : '#64748b',
            fontWeight: statusFilter === s.id ? 600 : 400,
            transition: 'all 0.2s ease',
          }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Lead cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {matched.map(({ lead, county, cashBuyers, jvPartners }) => (
          <div key={lead.lead_id} style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14,
            padding: '18px 22px',
          }}>
            {/* Lead info row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                  {lead.address_full || `${lead.address_street || ''}, ${lead.address_city || ''}`}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {lead.owner_name} {county && <span style={{ color: '#475569' }}>· {county} County</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {lead.arv_estimate && (
                  <span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 7 }}>
                    ARV ${(lead.arv_estimate / 1000).toFixed(0)}K
                  </span>
                )}
                {lead.mao && (
                  <span style={{ fontSize: 11, color: '#22c55e', background: 'rgba(34,197,94,0.08)', padding: '4px 10px', borderRadius: 7 }}>
                    MAO ${(lead.mao / 1000).toFixed(0)}K
                  </span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                  color: STATUS_COLORS[(lead as any)._dispo_status] || '#64748b',
                  background: `${STATUS_COLORS[(lead as any)._dispo_status] || '#64748b'}15`,
                  padding: '4px 10px', borderRadius: 7,
                }}>
                  {((lead as any)._dispo_status || '').replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Distress signals */}
            {lead.distress_signals.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {lead.distress_signals.map((s, i) => (
                  <span key={i} style={{
                    fontSize: 10, color: '#f87171', background: 'rgba(248,113,113,0.08)',
                    padding: '3px 8px', borderRadius: 6,
                  }}>
                    {s}
                  </span>
                ))}
              </div>
            )}

            {/* Matched buyers */}
            {(cashBuyers.length > 0 || jvPartners.length > 0) ? (
              <div>
                {cashBuyers.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      Cash Buyers ({cashBuyers.length})
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: jvPartners.length > 0 ? 14 : 0 }}>
                      {cashBuyers.sort((a, b) => a.tier - b.tier).map(buyer => (
                        <BuyerChip key={buyer.name} buyer={buyer} />
                      ))}
                    </div>
                  </>
                )}
                {jvPartners.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      JV Partners ({jvPartners.length})
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {jvPartners.map(buyer => (
                        <BuyerChip key={buyer.name} buyer={buyer} jv />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#475569', fontStyle: 'italic' }}>
                {county ? 'No buyers found for this county' : 'Could not determine county from address'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function BuyerChip({ buyer, jv }: { buyer: Buyer; jv?: boolean }) {
  const borderColor = jv ? 'rgba(245,158,11,0.2)' : buyer.tier === 1 ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'
  const bgColor = jv ? 'rgba(245,158,11,0.06)' : buyer.tier === 1 ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)'

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      padding: '10px 14px',
      minWidth: 180,
      maxWidth: 260,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{buyer.name}</div>
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: jv ? '#f59e0b' : buyer.tier === 1 ? '#818cf8' : '#64748b',
          background: jv ? 'rgba(245,158,11,0.12)' : buyer.tier === 1 ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.06)',
          padding: '2px 6px', borderRadius: 4,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {jv ? 'JV' : `T${buyer.tier}`}
        </span>
      </div>
      {buyer.phone && (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{buyer.phone}</div>
      )}
      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{buyer.model}</div>
    </div>
  )
}
