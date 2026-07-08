import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { UnderwritingReport } from '../../../api/types'

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
}

const GRADE_FILTERS = ['All', 'A', 'B', 'C', 'D', 'F', 'Pending'] as const

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString()
}

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 20 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

interface DealItem {
  lead_id: string
  address: string
  name: string
  grade: string | null
  status: string
  arv: number | null
  mao: number | null
  updated: string | null
}

export function DealQueue({ onViewReport }: { onViewReport: (leadId: string) => void }) {
  const [gradeFilter, setGradeFilter] = useState<string>('All')
  const queryClient = useQueryClient()

  const { data: reports } = useQuery({
    queryKey: ['underwriting-reports'],
    queryFn: () => hermesClient.underwriting.reports(),
    refetchInterval: 15_000,
  })

  const { data: interestedLeads } = useQuery({
    queryKey: ['underwriting-interested'],
    queryFn: () => hermesClient.leads.list({ status: 'interested' }),
    refetchInterval: 15_000,
  })

  const runUnderwriting = useMutation({
    mutationFn: (leadId: string) => hermesClient.underwriting.run(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underwriting-reports'] })
      queryClient.invalidateQueries({ queryKey: ['underwriting-interested'] })
    },
  })

  const reportLeadIds = new Set((reports || []).map(r => r.lead_id))
  const unreportedInterested = (interestedLeads || []).filter(l => !reportLeadIds.has(l.lead_id))

  const allItems: DealItem[] = [
    ...(reports || []).map((r: UnderwritingReport) => ({
      lead_id: r.lead_id,
      address: r.address_full || '—',
      name: r.owner_name || '—',
      grade: r.overall_grade,
      status: r.status,
      arv: r.arv_final,
      mao: r.mao_70,
      updated: r.updated_at,
    })),
    ...unreportedInterested.map(l => ({
      lead_id: l.lead_id,
      address: l.address_full || '—',
      name: l.owner_name || '—',
      grade: null,
      status: 'pending',
      arv: l.arv_estimate,
      mao: l.mao,
      updated: l.updated_at,
    })),
  ]

  const filtered = allItems.filter(item => {
    if (gradeFilter === 'All') return true
    if (gradeFilter === 'Pending') return !item.grade
    return item.grade === gradeFilter
  })

  const completedReports = (reports || []).filter(r => r.status === 'complete')
  const abDeals = completedReports.filter(r => r.overall_grade === 'A' || r.overall_grade === 'B')
  const maoValues = completedReports.filter(r => r.mao_70 != null).map(r => r.mao_70!)
  const avgMao = maoValues.length > 0 ? Math.round(maoValues.reduce((a, b) => a + b, 0) / maoValues.length) : 0
  const pendingCount = allItems.filter(i => !i.grade || i.status === 'pending').length

  return (
    <div>
      {/* Stats Row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16, marginBottom: 24,
      }}>
        <MetricCard label="Total Deals" value={String(allItems.length)} color="#6366f1" />
        <MetricCard label="A/B Deals" value={String(abDeals.length)} color="#22c55e"
          sub={allItems.length > 0 ? `${Math.round((abDeals.length / allItems.length) * 100)}% of pipeline` : undefined} />
        <MetricCard label="Avg MAO" value={avgMao > 0 ? fmt(avgMao) : '—'} color="#eab308"
          sub={maoValues.length > 0 ? `across ${maoValues.length} deals` : undefined} />
        <MetricCard label="Pending Analysis" value={String(pendingCount)} color="#a78bfa"
          sub={pendingCount > 0 ? 'awaiting underwriting' : 'all analyzed'} />
      </div>

      {/* Grade Filter */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {GRADE_FILTERS.map((g) => {
          const active = gradeFilter === g
          const count = g === 'All' ? allItems.length
            : g === 'Pending' ? allItems.filter(i => !i.grade).length
            : allItems.filter(i => i.grade === g).length
          const color = g === 'All' || g === 'Pending' ? '#6366f1' : GRADE_COLORS[g] || '#666'

          return (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              style={{
                padding: '5px 12px', borderRadius: 4, border: 'none', fontSize: 11, cursor: 'pointer',
                background: active ? color + '20' : 'rgba(255,255,255,0.03)',
                color: active ? color : '#64748b',
                fontWeight: active ? 600 : 400,
              }}
            >
              {g} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Deal Table */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 32, border: '1px dashed #2a2a3e', borderRadius: 14,
          textAlign: 'center', color: '#334155',
        }}>
          <p>No leads in underwriting yet.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Mark leads as "interested" from the call list to auto-trigger underwriting.
          </p>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Grade', 'Address', 'Owner', 'ARV', 'MAO (70%)', 'Status', ''].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Grade' ? 'center' : 'left', padding: '10px 12px',
                    fontSize: 10, color: '#475569', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.lead_id}
                  onClick={() => item.grade ? onViewReport(item.lead_id) : undefined}
                  style={{
                    cursor: item.grade ? 'pointer' : 'default',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                  onMouseOver={(e) => { if (item.grade) e.currentTarget.style.background = 'rgba(99,102,241,0.06)' }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {item.grade ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 6, fontSize: 14, fontWeight: 700,
                        color: GRADE_COLORS[item.grade] || '#666',
                        background: (GRADE_COLORS[item.grade] || '#666') + '18',
                      }}>
                        {item.grade}
                      </span>
                    ) : (
                      <div style={{
                        width: 28, height: 28, borderRadius: 6, display: 'inline-flex', alignItems: 'center',
                        justifyContent: 'center', background: '#22222e',
                      }}>
                        <div style={{ width: 10, height: 10, border: '2px solid #555', borderTopColor: '#818cf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#e2e8f0', fontSize: 13 }}>
                    {item.address}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 13 }}>
                    {item.name}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>
                    {fmt(item.arv)}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#22c55e', fontSize: 13, fontWeight: 600 }}>
                    {fmt(item.mao)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      color: item.status === 'complete' ? '#22c55e' : item.status === 'pending' ? '#a78bfa' : '#64748b',
                      background: item.status === 'complete' ? '#22c55e18' : item.status === 'pending' ? '#a78bfa18' : '#22222e',
                      textTransform: 'uppercase',
                    }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {item.grade ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewReport(item.lead_id) }}
                        style={{
                          padding: '4px 10px', borderRadius: 4, border: 'none',
                          background: '#6366f118', color: '#818cf8', fontSize: 11,
                          fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        View
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); runUnderwriting.mutate(item.lead_id) }}
                        disabled={runUnderwriting.isPending}
                        style={{
                          padding: '4px 10px', borderRadius: 4, border: 'none',
                          background: '#a78bfa18', color: '#a78bfa', fontSize: 11,
                          fontWeight: 600, cursor: 'pointer',
                          opacity: runUnderwriting.isPending ? 0.5 : 1,
                        }}
                      >
                        {runUnderwriting.isPending ? 'Running...' : 'Run Analysis'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
