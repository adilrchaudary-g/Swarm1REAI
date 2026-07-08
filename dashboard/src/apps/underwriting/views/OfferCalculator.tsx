import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { UnderwritingReport } from '../../../api/types'

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}

function calculateGrade(arv: number, mao: number, repairAvg: number, confidence: number): { grade: string; recommendation: string } {
  if (arv <= 0) return { grade: 'F', recommendation: 'Insufficient data to evaluate' }
  const spread = arv - mao - repairAvg
  if (spread >= 40_000 && confidence >= 0.5) return { grade: 'A', recommendation: 'Strong Buy — healthy spread, good data confidence' }
  if (spread >= 25_000 && confidence >= 0.4) return { grade: 'B', recommendation: 'Proceed — solid numbers, verify condition and comps' }
  if (spread >= 15_000) return { grade: 'C', recommendation: 'Proceed with Caution — tight margins, need accurate repair estimate' }
  if (spread >= 5_000) return { grade: 'D', recommendation: 'Marginal — very thin deal, only if repairs come in low' }
  return { grade: 'F', recommendation: "Pass — numbers don't work at this discount" }
}

const inputStyle = {
  width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#e2e8f0', fontSize: 14,
}

const labelStyle = {
  fontSize: 12, color: '#94a3b8', marginBottom: 4, fontWeight: 500 as const, display: 'block' as const,
}

export function OfferCalculator() {
  const { data: reports } = useQuery({
    queryKey: ['underwriting-reports'],
    queryFn: () => hermesClient.underwriting.reports(),
    refetchInterval: 30_000,
  })

  const completedReports = (reports || []).filter((r: UnderwritingReport) => r.status === 'complete')

  const [selectedLeadId, setSelectedLeadId] = useState<string>('')
  const [arv, setArv] = useState(0)
  const [repairs, setRepairs] = useState(0)
  const [maoPct, setMaoPct] = useState(70)
  const [assignmentFee, setAssignmentFee] = useState(20000)
  const [holdingCosts, setHoldingCosts] = useState(0)

  useEffect(() => {
    if (!selectedLeadId) return
    const report = completedReports.find((r: UnderwritingReport) => r.lead_id === selectedLeadId)
    if (!report) return
    setArv(report.arv_final || 0)
    const repairAvg = (report.repair_estimate_low != null && report.repair_estimate_high != null)
      ? Math.round((report.repair_estimate_low + report.repair_estimate_high) / 2) : 0
    setRepairs(repairAvg)
    const feeMid = (report.assignment_fee_low != null && report.assignment_fee_high != null)
      ? Math.round((report.assignment_fee_low + report.assignment_fee_high) / 2) : 20000
    setAssignmentFee(feeMid)
    setHoldingCosts(report.holding_costs || 0)
    setMaoPct(70)
  }, [selectedLeadId])

  const mao = arv > 0 ? Math.round(arv * (maoPct / 100) - repairs - assignmentFee - holdingCosts) : 0
  const maoConservative = arv > 0 ? Math.round(arv * ((maoPct - 5) / 100) - repairs - assignmentFee - holdingCosts) : 0
  const spread = arv - mao - repairs
  const totalInvestment = Math.max(1, mao + repairs + holdingCosts)
  const monthlyRent = Math.round(arv * 0.01)
  const annualRent = monthlyRent * 12
  const annualExpenses = Math.round(annualRent * 0.45)
  const cashOnCash = Math.round((annualRent - annualExpenses) / totalInvestment * 100 * 10) / 10

  const selectedReport = completedReports.find((r: UnderwritingReport) => r.lead_id === selectedLeadId)
  const confidence = selectedReport?.arv_confidence || 0.5
  const { grade, recommendation } = calculateGrade(arv, mao, repairs, confidence)
  const gradeColor = GRADE_COLORS[grade] || '#666'

  return (
    <div>
      {/* Deal Selector */}
      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Select a deal to pre-fill, or enter numbers manually</label>
        <select
          value={selectedLeadId}
          onChange={(e) => setSelectedLeadId(e.target.value)}
          style={{ ...inputStyle, maxWidth: 500 }}
        >
          <option value="">— Manual Entry —</option>
          {completedReports.map((r: UnderwritingReport) => (
            <option key={r.lead_id} value={r.lead_id}>
              [{r.overall_grade || '?'}] {r.address_full || r.lead_id} — ARV {r.arv_final ? fmt(r.arv_final) : '—'}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Inputs */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Deal Inputs
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>After Repair Value (ARV)</label>
            <input type="number" value={arv || ''} onChange={(e) => setArv(Number(e.target.value) || 0)}
              placeholder="250000" style={inputStyle} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Repair Estimate</label>
            <input type="number" value={repairs || ''} onChange={(e) => setRepairs(Number(e.target.value) || 0)}
              placeholder="25000" style={inputStyle} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              MAO Percentage: <span style={{ color: '#6366f1', fontWeight: 700 }}>{maoPct}%</span>
            </label>
            <input type="range" min={50} max={80} value={maoPct} onChange={(e) => setMaoPct(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569' }}>
              <span>50%</span>
              <span>65%</span>
              <span>70%</span>
              <span>80%</span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Assignment Fee Target</label>
            <input type="number" value={assignmentFee || ''} onChange={(e) => setAssignmentFee(Number(e.target.value) || 0)}
              placeholder="20000" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Holding Costs</label>
            <input type="number" value={holdingCosts || ''} onChange={(e) => setHoldingCosts(Number(e.target.value) || 0)}
              placeholder="15000" style={inputStyle} />
          </div>
        </div>

        {/* Right: Outputs */}
        <div>
          {/* Grade Badge */}
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 28, fontWeight: 800, color: gradeColor,
              background: gradeColor + '18', border: `2px solid ${gradeColor}50`,
            }}>
              {grade}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: gradeColor, fontSize: 14, fontWeight: 600 }}>{recommendation}</div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
                Based on {maoPct}% rule with {fmt(repairs)} repairs
              </div>
            </div>
          </div>

          {/* Result Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>MAX OFFER ({maoPct}%)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: mao > 0 ? '#22c55e' : '#ef4444' }}>{fmt(mao)}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>CONSERVATIVE ({maoPct - 5}%)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: maoConservative > 0 ? '#22c55e' : '#ef4444' }}>{fmt(maoConservative)}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>SPREAD</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: spread > 0 ? '#eab308' : '#ef4444' }}>{fmt(spread)}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>BUYER CASH-ON-CASH</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: cashOnCash > 0 ? '#a78bfa' : '#ef4444' }}>{cashOnCash}%</div>
            </div>
          </div>

          {/* Deal Math Breakdown */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Deal Math Breakdown
            </div>
            {[
              { label: 'ARV', value: fmt(arv), color: '#a78bfa' },
              { label: `Discount (${maoPct}%)`, value: fmt(arv * (maoPct / 100)), color: '#6366f1' },
              { label: 'Less: Repairs', value: `- ${fmt(repairs)}`, color: '#f87171' },
              { label: 'Less: Assignment Fee', value: `- ${fmt(assignmentFee)}`, color: '#f87171' },
              { label: 'Less: Holding Costs', value: `- ${fmt(holdingCosts)}`, color: '#f87171' },
              { label: 'Max Offer Price', value: fmt(mao), color: '#22c55e', bold: true },
            ].map((row) => (
              <div key={row.label} style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 0',
                borderBottom: '1px solid #1a1a2e',
              }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>{row.label}</span>
                <span style={{
                  color: row.color, fontSize: 12,
                  fontWeight: (row as any).bold ? 700 : 600,
                }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
