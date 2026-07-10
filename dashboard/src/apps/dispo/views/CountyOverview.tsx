import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import { COUNTY_DATA, BUYERS, getCountyForCity } from '../buyer-data'
import type { Lead } from '../../../api/types'

function useDispoLeads() {
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
  const under_contract = useQuery({
    queryKey: ['dispo-leads', 'under_contract'],
    queryFn: () => hermesClient.leads.list({ status: 'under_contract', limit: 500 }),
    staleTime: 30_000,
  })

  const all = useMemo(() => [
    ...(interested.data || []),
    ...(underwriting.data || []),
    ...(under_contract.data || []),
  ], [interested.data, underwriting.data, under_contract.data])

  return {
    leads: all,
    loading: interested.isLoading || underwriting.isLoading || under_contract.isLoading,
  }
}

function groupLeadsByCounty(leads: Lead[]): Record<string, Lead[]> {
  const groups: Record<string, Lead[]> = {}
  for (const lead of leads) {
    if (!lead.address_city || !lead.address_state) continue
    const county = getCountyForCity(lead.address_city, lead.address_state)
    if (county) {
      if (!groups[county]) groups[county] = []
      groups[county].push(lead)
    }
  }
  return groups
}

export function CountyOverview() {
  const { leads, loading } = useDispoLeads()
  const pipelineStats = useQuery({
    queryKey: ['pipeline-stats'],
    queryFn: () => hermesClient.pipeline.stats(),
    staleTime: 30_000,
  })

  const dispoByCounty = useMemo(() => groupLeadsByCounty(leads), [leads])

  const ohioData = COUNTY_DATA.filter(c => c.state === 'OH')
  const texasData = COUNTY_DATA.filter(c => c.state === 'TX')
  const ohioTotal = ohioData.reduce((s, c) => s + c.leads, 0)
  const texasTotal = texasData.reduce((s, c) => s + c.leads, 0)
  const ohioDispo = ohioData.reduce((s, c) => s + (dispoByCounty[c.county]?.length || 0), 0)
  const texasDispo = texasData.reduce((s, c) => s + (dispoByCounty[c.county]?.length || 0), 0)

  const byStatus = (pipelineStats.data as any)?.by_status || {}

  return (
    <div>
      {/* State summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
        <StateSummary label="Ohio" total={ohioTotal} dispo={ohioDispo} counties={ohioData.length}
          underContract={byStatus['under_contract'] || 0} closed={byStatus['closed_won'] || 0} />
        <StateSummary label="Texas" total={texasTotal} dispo={texasDispo} counties={texasData.length}
          underContract={byStatus['under_contract'] || 0} closed={byStatus['closed_won'] || 0} />
      </div>

      {/* County grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {COUNTY_DATA.map(county => {
          const cashBuyers = BUYERS.filter(b => b.type === 'cash' && b.counties.includes(county.county))
          const jvPartners = BUYERS.filter(b => b.type === 'jv' && b.counties.includes(county.county))
          const t1 = cashBuyers.filter(b => b.tier === 1).length + jvPartners.filter(b => b.tier === 1).length
          const totalBuyers = cashBuyers.length + jvPartners.length
          const dispoReady = dispoByCounty[county.county]?.length || 0

          const coverage = totalBuyers >= 3 ? 'good' : totalBuyers >= 1 ? 'fair' : 'none'
          const stripeColor = coverage === 'good' ? '#22c55e' : coverage === 'fair' ? '#eab308' : '#ef4444'

          return (
            <div key={county.county} style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: '18px 20px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
                background: stripeColor, borderRadius: '14px 0 0 14px',
                opacity: 0.8,
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{county.county}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{county.state}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: stripeColor,
                  background: `${stripeColor}15`,
                  padding: '3px 8px', borderRadius: 6,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {coverage === 'good' ? 'Covered' : coverage === 'fair' ? 'Thin' : 'No Buyers'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Metric label="Total Leads" value={county.leads} />
                <Metric label="Dispo Ready" value={dispoReady} accent={dispoReady > 0} />
                <Metric label="Cash Buyers" value={cashBuyers.length} />
                <Metric label="JV Partners" value={jvPartners.length} accent={jvPartners.length > 0} jv />
                <Metric label="Tier 1" value={t1} />
              </div>

              <div style={{ marginTop: 10, fontSize: 11, color: '#475569', lineHeight: 1.4 }}>
                {county.cities}
              </div>
            </div>
          )
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: 40 }}>
          Loading dispo pipeline...
        </div>
      )}
    </div>
  )
}

function StateSummary({ label, total, dispo, counties, underContract, closed }: {
  label: string; total: number; dispo: number; counties: number; underContract: number; closed: number
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: '20px 24px',
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>{counties} counties</div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#c7d2fe', fontVariantNumeric: 'tabular-nums' }}>{total.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Total Leads</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#818cf8', fontVariantNumeric: 'tabular-nums' }}>{dispo}</div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Dispo Ready</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e', fontVariantNumeric: 'tabular-nums' }}>{closed}</div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Closed</div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, accent, jv }: { label: string; value: number; accent?: boolean; jv?: boolean }) {
  return (
    <div>
      <div style={{
        fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: jv ? '#f59e0b' : accent ? '#818cf8' : '#e2e8f0',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}
