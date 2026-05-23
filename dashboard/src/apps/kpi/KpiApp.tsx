import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { KpiSummary, FollowUp, DailyActivity, SourceRoi } from '../../api/types'

const OUTCOMES = [
  { value: 'no_answer', label: 'No Answer', color: '#888' },
  { value: 'interested', label: 'Interested', color: '#22c55e' },
  { value: 'not_interested', label: 'Not Interested', color: '#ef4444' },
  { value: 'rescheduled', label: 'Rescheduled', color: '#eab308' },
]

const FUNNEL_STAGES = [
  { key: 'imported', label: 'Imported', color: '#666' },
  { key: 'new', label: 'Evaluated', color: '#6366f1' },
  { key: 'queued', label: 'Queued', color: '#818cf8' },
  { key: 'contacted', label: 'Called', color: '#a78bfa' },
  { key: 'interested', label: 'Interested', color: '#eab308' },
  { key: 'under_contract', label: 'Contract', color: '#22c55e' },
  { key: 'closed_won', label: 'Closed', color: '#4ade80' },
]

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Conversion Funnel ───────────────────────────────────────

function ConversionFunnel() {
  const { data: funnel } = useQuery({
    queryKey: ['kpi-funnel'],
    queryFn: () => hermesClient.kpi.funnel(30),
    refetchInterval: 30_000,
  })

  if (!funnel) return null
  const current = funnel.current || {}
  const maxVal = Math.max(1, ...FUNNEL_STAGES.map(s => (current[s.key] || 0)))

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Pipeline Funnel (current)
      </div>
      {FUNNEL_STAGES.map((stage, i) => {
        const count = current[stage.key] || 0
        const width = Math.max(2, (count / maxVal) * 100)
        const prev = i > 0 ? (current[FUNNEL_STAGES[i - 1].key] || 0) : 0
        const convRate = prev > 0 ? Math.round((count / prev) * 100) : null

        return (
          <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 80, fontSize: 11, color: '#888', textAlign: 'right', flexShrink: 0 }}>
              {stage.label}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 24 }}>
              <div style={{
                width: `${width}%`, height: '100%', background: stage.color + '30',
                borderRadius: 4, border: `1px solid ${stage.color}50`,
                display: 'flex', alignItems: 'center', paddingLeft: 8, minWidth: 40,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: stage.color }}>{count}</span>
              </div>
            </div>
            {convRate !== null && (
              <div style={{ width: 40, fontSize: 10, color: '#555', textAlign: 'right', flexShrink: 0 }}>
                {convRate}%
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Call Metrics Row ────────────────────────────────────────

function CallMetricsRow() {
  const { data: metrics } = useQuery({
    queryKey: ['kpi-calls'],
    queryFn: () => hermesClient.kpi.calls(7),
    refetchInterval: 30_000,
  })

  if (!metrics) return null

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <MetricCard label="Calls This Week" value={String(metrics.calls_made)} color="#6366f1" />
      <MetricCard label="Contacted" value={String(metrics.contacted)} color="#a78bfa" />
      <MetricCard label="Contact Rate" value={`${metrics.contact_rate}%`} color="#22c55e"
        sub={`${metrics.contacted} / ${metrics.calls_made}`} />
      <MetricCard label="Interest Rate" value={`${metrics.interest_rate}%`} color="#eab308"
        sub={`${metrics.interested} interested`} />
    </div>
  )
}

// ── Daily Activity Chart (SVG) ──────────────────────────────

function DailyActivityChart() {
  const [days, setDays] = useState(14)
  const { data: daily } = useQuery({
    queryKey: ['kpi-daily', days],
    queryFn: () => hermesClient.kpi.daily(days),
    refetchInterval: 60_000,
  })

  if (!daily || daily.length === 0) return null

  const maxCalls = Math.max(1, ...daily.map(d => d.calls))
  const barW = Math.max(8, Math.min(24, 600 / daily.length - 4))
  const chartH = 120
  const chartW = daily.length * (barW + 4) + 20

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Daily Activity
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: '3px 8px', borderRadius: 3, border: 'none', fontSize: 10, cursor: 'pointer',
                background: days === d ? '#6366f130' : '#1e1e2e', color: days === d ? '#818cf8' : '#666',
              }}>{d}d</button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={chartW} height={chartH + 30} style={{ display: 'block' }}>
          {daily.map((d, i) => {
            const x = i * (barW + 4) + 10
            const callH = (d.calls / maxCalls) * chartH
            const intH = (d.interested / maxCalls) * chartH
            return (
              <g key={d.day}>
                <rect x={x} y={chartH - callH} width={barW} height={callH} rx={2}
                  fill="#6366f140" stroke="#6366f180" strokeWidth={0.5} />
                {d.interested > 0 && (
                  <rect x={x} y={chartH - intH} width={barW} height={intH} rx={2}
                    fill="#eab30880" />
                )}
                <text x={x + barW / 2} y={chartH + 14} textAnchor="middle"
                  fill="#555" fontSize={8}>
                  {d.day.slice(5)}
                </text>
                {d.calls > 0 && (
                  <text x={x + barW / 2} y={chartH - callH - 4} textAnchor="middle"
                    fill="#888" fontSize={8}>
                    {d.calls}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 10, background: '#6366f140', border: '1px solid #6366f180', borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#666' }}>Calls</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 10, background: '#eab30880', borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#666' }}>Interested</span>
        </div>
      </div>
    </div>
  )
}

// ── Source ROI Table ─────────────────────────────────────────

function SourceRoiTable() {
  const { data: sources } = useQuery({
    queryKey: ['kpi-source-roi'],
    queryFn: hermesClient.kpi.sourceRoi,
    refetchInterval: 30_000,
  })

  if (!sources || sources.length === 0) return null

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Source Performance
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Source', 'Total', 'Queued', 'Contacted', 'Interested', 'Pipeline', 'Won'].map(h => (
              <th key={h} style={{
                textAlign: h === 'Source' ? 'left' : 'right', padding: '6px 8px',
                fontSize: 10, color: '#555', borderBottom: '1px solid #1e1e2e', textTransform: 'uppercase',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((s: SourceRoi) => (
            <tr key={s.source}>
              <td style={{ padding: '8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #0a0a12' }}>
                {s.source || 'Unknown'}
              </td>
              {[s.total_leads, s.queued, s.contacted, s.interested, s.in_underwriting, s.closed_won].map((v, i) => (
                <td key={i} style={{
                  padding: '8px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid #0a0a12',
                  color: i === 3 ? '#eab308' : i === 5 ? '#22c55e' : '#888',
                  fontWeight: (i === 3 || i === 5) && v > 0 ? 600 : 400,
                }}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Follow-Up Section ───────────────────────────────────────

function FollowUpRow({ fu }: { fu: FollowUp }) {
  const queryClient = useQueryClient()
  const [showOutcome, setShowOutcome] = useState(false)
  const overdue = fu.scheduled_at && new Date(fu.scheduled_at) < new Date()

  const complete = useMutation({
    mutationFn: (outcome: string) => hermesClient.followUps.complete(fu.id, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] })
    },
  })

  return (
    <div style={{
      padding: '12px 16px', background: '#111118', border: '1px solid #1e1e2e',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#ccc', fontSize: 13 }}>{fu.address_full || fu.lead_id}</div>
          <div style={{ color: '#888', fontSize: 11 }}>
            {fu.owner_name} &middot; {fu.follow_up_type}
            {fu.lead_status && <span style={{ marginLeft: 4, color: '#555' }}>({fu.lead_status})</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: overdue ? '#ef4444' : '#eab308', fontSize: 12, fontWeight: 600 }}>
              {new Date(fu.scheduled_at).toLocaleDateString()}
            </div>
            {overdue && <div style={{ color: '#ef4444', fontSize: 10 }}>OVERDUE</div>}
          </div>
          {!showOutcome && (
            <button onClick={() => setShowOutcome(true)}
              style={{
                padding: '5px 10px', borderRadius: 4, border: 'none',
                background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>Done</button>
          )}
        </div>
      </div>
      {fu.notes && <div style={{ color: '#555', fontSize: 11, marginTop: 6 }}>{fu.notes}</div>}
      {showOutcome && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {OUTCOMES.map((o) => (
            <button key={o.value} onClick={() => complete.mutate(o.value)} disabled={complete.isPending}
              style={{
                padding: '4px 10px', borderRadius: 4, border: 'none',
                background: complete.isPending ? o.color + '30' : o.color + '18', color: o.color,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: complete.isPending ? 0.6 : 1,
              }}>{complete.isPending ? '...' : o.label}</button>
          ))}
          <button onClick={() => setShowOutcome(false)}
            style={{
              padding: '4px 10px', borderRadius: 4, border: 'none',
              background: '#1e1e2e', color: '#666', fontSize: 11, cursor: 'pointer',
            }}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function FollowUpSection() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'today' | 'overdue' | 'week' | 'all'>('today')
  const [showSchedule, setShowSchedule] = useState(false)
  const [fuLeadId, setFuLeadId] = useState('')
  const [fuDate, setFuDate] = useState('')
  const [fuNotes, setFuNotes] = useState('')

  const { data: followUps } = useQuery({
    queryKey: ['follow-ups'],
    queryFn: hermesClient.followUps.list,
    refetchInterval: 30_000,
  })

  const createFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(fuLeadId, 'callback', fuDate, fuNotes || undefined),
    onSuccess: () => {
      setShowSchedule(false); setFuLeadId(''); setFuDate(''); setFuNotes('')
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]

  const filtered = (followUps || []).filter(fu => {
    const d = fu.scheduled_at?.split('T')[0] || ''
    if (tab === 'today') return d <= todayStr
    if (tab === 'overdue') return d < todayStr
    if (tab === 'week') return d <= weekEnd
    return true
  })

  const overdueCount = (followUps || []).filter(fu => (fu.scheduled_at?.split('T')[0] || '') < todayStr).length

  const inputStyle = {
    width: '100%', padding: '6px 8px', background: '#0a0a0f',
    border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13,
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { key: 'today', label: 'Today' },
            { key: 'overdue', label: `Overdue${overdueCount ? ` (${overdueCount})` : ''}` },
            { key: 'week', label: 'This Week' },
            { key: 'all', label: 'All' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 11, cursor: 'pointer',
                background: tab === t.key ? '#6366f130' : '#1e1e2e',
                color: tab === t.key ? '#818cf8' : '#666',
                fontWeight: tab === t.key ? 600 : 400,
              }}>{t.label}</button>
          ))}
        </div>
        <button onClick={() => setShowSchedule(!showSchedule)}
          style={{
            padding: '5px 12px', borderRadius: 4, border: 'none',
            background: showSchedule ? '#1e1e2e' : '#eab30818', color: showSchedule ? '#888' : '#eab308',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{showSchedule ? 'Cancel' : '+ Schedule'}</button>
      </div>

      {showSchedule && (
        <div style={{
          padding: 16, background: '#111118', border: '1px solid #1e1e2e',
          borderRadius: 8, marginBottom: 12,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Lead ID</label>
              <input value={fuLeadId} onChange={(e) => setFuLeadId(e.target.value)} placeholder="lead_id..." style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Date</label>
              <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <input value={fuNotes} onChange={(e) => setFuNotes(e.target.value)} placeholder="Notes (optional)..." style={{ ...inputStyle, marginBottom: 10 }} />
          <button onClick={() => createFollowUp.mutate()} disabled={!fuLeadId.trim() || !fuDate || createFollowUp.isPending}
            style={{
              padding: '7px 16px', borderRadius: 4, border: 'none',
              background: fuLeadId.trim() && fuDate ? '#eab308' : '#222',
              color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{createFollowUp.isPending ? 'Saving...' : 'Schedule Follow-Up'}</button>
        </div>
      )}

      {filtered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((fu) => <FollowUpRow key={fu.id} fu={fu} />)}
        </div>
      ) : (
        <div style={{
          padding: 24, border: '1px dashed #2a2a3e', borderRadius: 8,
          textAlign: 'center', color: '#444', fontSize: 13,
        }}>
          No follow-ups {tab === 'all' ? 'scheduled' : `for ${tab}`}.
        </div>
      )}
    </div>
  )
}

// ── Main KPI App ────────────────────────────────────────────

export function KpiApp() {
  const { data: kpi, error: kpiError } = useQuery({
    queryKey: ['kpi-summary'],
    queryFn: hermesClient.kpi.summary,
    refetchInterval: 15_000,
  })

  const k = kpi as KpiSummary | undefined

  return (
    <div>
      <h2 style={{ color: '#e0e0e0', fontSize: 20, marginBottom: 8 }}>
        KPI Dashboard
      </h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Pipeline metrics, call performance, source ROI, and follow-up management.
      </p>

      {/* Top-level metrics */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16, marginBottom: 24,
      }}>
        <MetricCard label="Total Leads" value={kpiError ? '—' : String(k?.total_leads ?? 0)} color="#6366f1" />
        <MetricCard label="Deals Closed" value={String(k?.deals_closed ?? 0)} color="#22c55e" />
        <MetricCard label="Pipeline Value" value={`$${(k?.pipeline_value ?? 0).toLocaleString()}`} color="#eab308" />
        <MetricCard label="Follow-Ups Due" value={String(k?.follow_ups_due ?? 0)} color="#ef4444" />
      </div>

      {/* Call metrics */}
      <CallMetricsRow />

      {/* Funnel + Chart side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ConversionFunnel />
        <DailyActivityChart />
      </div>

      {/* Source ROI */}
      <SourceRoiTable />

      {/* Follow-ups */}
      <h3 style={{ color: '#ccc', fontSize: 14, marginBottom: 12, marginTop: 8 }}>Follow-Ups</h3>
      <FollowUpSection />
    </div>
  )
}
