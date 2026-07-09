import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import { useAuthStore } from '../../store/auth-store'
import type { KpiSummary, FollowUp, SourceRoi, TrackerDayPoint, CallerActivity } from '../../api/types'

const OUTCOMES = [
  { value: 'no_answer', label: 'No Answer', color: '#94a3b8' },
  { value: 'interested', label: 'Interested', color: '#22c55e' },
  { value: 'not_interested', label: 'Not Interested', color: '#ef4444' },
  { value: 'rescheduled', label: 'Rescheduled', color: '#eab308' },
]

const FUNNEL_STAGES = [
  { key: 'imported', label: 'Imported', color: '#64748b' },
  { key: 'new', label: 'Evaluated', color: '#6366f1' },
  { key: 'queued', label: 'Queued', color: '#818cf8' },
  { key: 'contacted', label: 'Called', color: '#a78bfa' },
  { key: 'interested', label: 'Interested', color: '#eab308' },
  { key: 'under_contract', label: 'Contract', color: '#22c55e' },
  { key: 'closed_won', label: 'Closed', color: '#4ade80' },
]

// ── Trophy Card ──────────────────────────────────────────────

function TrophyCard({ label, value, color, sub, icon, glow }: {
  label: string; value: string; color: string; sub?: string; icon?: string; glow?: boolean
}) {
  return (
    <div style={{
      background: glow
        ? `linear-gradient(135deg, ${color}08 0%, rgba(255,255,255,0.03) 100%)`
        : 'rgba(255,255,255,0.03)',
      border: `1px solid ${glow ? color + '30' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 16, padding: 20,
      transition: 'border-color 0.3s, box-shadow 0.3s',
      ...(glow ? { boxShadow: `0 0 20px ${color}10` } : {}),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        {icon && <span style={{ fontSize: 18, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────

function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(1, ...data)
  const w = 120
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - (v / max) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {data.length > 0 && (() => {
        const lastX = w
        const lastY = height - (data[data.length - 1] / max) * (height - 4) - 2
        return <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
      })()}
    </svg>
  )
}

// ── Dial Streak ───────────────────────────────────────────

function DialStreakBanner() {
  const { data: streak } = useQuery({
    queryKey: ['kpi-dial-streak'],
    queryFn: hermesClient.kpi.dialStreak,
    refetchInterval: 30_000,
  })

  if (!streak) return null

  const fire = streak.current_streak >= 3
  const cold = streak.current_streak === 0

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 20px', marginBottom: 20, borderRadius: 16,
      background: fire ? 'rgba(234,179,8,0.08)' : cold ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.08)',
      border: `1px solid ${fire ? 'rgba(234,179,8,0.2)' : cold ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.15)'}`,
    }}>
      <div style={{ fontSize: 36, lineHeight: 1 }}>
        {fire ? '🔥' : cold ? '🧊' : '📞'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 20, fontWeight: 800, letterSpacing: -0.5,
          color: fire ? '#eab308' : cold ? '#ef4444' : '#6366f1',
        }}>
          {streak.current_streak} Day Streak
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {cold
            ? `Last dialed ${streak.last_dial_date ? new Date(streak.last_dial_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}. Get back on the phone.`
            : `Best: ${streak.best_streak} days · ${streak.total_active_days} total dial days`
          }
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase' }}>Best Streak</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#475569' }}>{streak.best_streak}</div>
      </div>
    </div>
  )
}

// ── Daily Tracker ──────────────────────────────────────────

function ProgressRing({ value, max, color, size = 48 }: { value: number; max: number; color: string; size?: number }) {
  const pct = Math.min(1, value / Math.max(1, max))
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color + '15'} strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pct >= 1 ? '#22c55e' : color}
        strokeWidth={4} strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  )
}

function DailyTracker() {
  const { data: tracker } = useQuery({
    queryKey: ['kpi-tracker'],
    queryFn: hermesClient.kpi.tracker,
    refetchInterval: 15_000,
  })

  if (!tracker) return null

  const convosHistory = (tracker.history || []).map((d: TrackerDayPoint) => d.convos)
  const leadsHistory = (tracker.history || []).map((d: TrackerDayPoint) => d.leads)

  const CALL_TARGET = 300
  const WEEK_TARGET = CALL_TARGET * 5
  const CONVO_TARGET = 20
  const LEAD_TARGET = 5

  const callPct = Math.min(100, Math.round((tracker.calls_today / CALL_TARGET) * 100))
  const leadPct = Math.min(100, Math.round((tracker.real_leads_week / LEAD_TARGET) * 100))

  const bd = tracker.disposition_breakdown || {}

  const history = tracker.history || []
  const activeDays = history.filter((d: TrackerDayPoint) => d.calls > 0).length
  const dailyAvg = activeDays > 0 ? Math.round((tracker.calls_week || 0) / activeDays) : 0

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Daily Tracker
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
        {/* Dials Today */}
        <div style={{
          background: callPct >= 100
            ? 'linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(255,255,255,0.03) 100%)'
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${callPct >= 100 ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 16, padding: 20,
          ...(callPct >= 100 ? { boxShadow: '0 0 24px rgba(34,197,94,0.08)' } : {}),
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
            DIALS TODAY {callPct >= 100 && '✅'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProgressRing value={tracker.calls_today} max={CALL_TARGET} color="#6366f1" />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: callPct >= 100 ? '#22c55e' : '#6366f1', lineHeight: 1 }}>
                  {tracker.calls_today}
                </span>
                <span style={{ fontSize: 13, color: '#475569' }}>/ {CALL_TARGET}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{callPct}% of target</div>
            </div>
          </div>
        </div>

        {/* Calls This Week */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, padding: 20,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>DIALS THIS WEEK</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProgressRing value={tracker.calls_week || 0} max={WEEK_TARGET} color="#818cf8" />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#818cf8', lineHeight: 1 }}>
                  {tracker.calls_week || 0}
                </span>
                <span style={{ fontSize: 13, color: '#475569' }}>/ {WEEK_TARGET.toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                {dailyAvg} avg/day across {activeDays} days
              </div>
            </div>
          </div>
        </div>

        {/* Pickups Today */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, padding: 20, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.6 }}>
            <Sparkline data={convosHistory} color="#22c55e" />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>PICKUPS TODAY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProgressRing value={tracker.real_convos_today} max={CONVO_TARGET} color="#22c55e" />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>
                  {tracker.real_convos_today}
                </span>
                <span style={{ fontSize: 13, color: '#475569' }}>/ {CONVO_TARGET}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                {tracker.pickup_rate}% pickup rate
              </div>
            </div>
          </div>
        </div>

        {/* Interested This Week */}
        <div style={{
          background: tracker.real_leads_week > 0
            ? 'linear-gradient(135deg, rgba(234,179,8,0.06) 0%, rgba(255,255,255,0.03) 100%)'
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${tracker.real_leads_week > 0 ? 'rgba(234,179,8,0.25)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 16, padding: 20, position: 'relative', overflow: 'hidden',
          ...(tracker.real_leads_week > 0 ? { boxShadow: '0 0 24px rgba(234,179,8,0.08)' } : {}),
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.6 }}>
            <Sparkline data={leadsHistory} color="#eab308" />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
            INTERESTED THIS WEEK {tracker.real_leads_week >= LEAD_TARGET && '🏆'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProgressRing value={tracker.real_leads_week} max={LEAD_TARGET} color="#eab308" />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: '#eab308', lineHeight: 1 }}>
                  {tracker.real_leads_week}
                </span>
                <span style={{ fontSize: 13, color: '#475569' }}>/ {LEAD_TARGET}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{leadPct}% of target</div>
            </div>
          </div>
        </div>
      </div>

      {/* Disposition Breakdown Bar */}
      {tracker.calls_today > 0 && (
        <div style={{
          marginTop: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Today's Breakdown
          </div>
          {/* Stacked bar */}
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            {[
              { key: 'no_answer', color: '#64748b', label: 'No Answer' },
              { key: 'voicemail', color: '#a78bfa', label: 'Voicemail' },
              { key: 'bad_number', color: '#ef4444', label: 'Bad Number' },
              { key: 'answered', color: '#22c55e', label: 'Answered' },
              { key: 'not_interested', color: '#f97316', label: 'Not Interested' },
              { key: 'interested', color: '#eab308', label: 'Interested' },
            ].map(d => {
              const count = bd[d.key] || 0
              if (count === 0) return null
              const pctW = (count / tracker.calls_today) * 100
              return (
                <div key={d.key} title={`${d.label}: ${count}`}
                  style={{ width: `${pctW}%`, background: d.color, minWidth: count > 0 ? 2 : 0, transition: 'width 0.5s' }} />
              )
            })}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {[
              { key: 'no_answer', color: '#64748b', label: 'No Answer' },
              { key: 'voicemail', color: '#a78bfa', label: 'VM' },
              { key: 'bad_number', color: '#ef4444', label: 'Bad #' },
              { key: 'answered', color: '#22c55e', label: 'Answered' },
              { key: 'not_interested', color: '#f97316', label: 'Not Int.' },
              { key: 'interested', color: '#eab308', label: 'Interested' },
            ].map(d => {
              const count = bd[d.key] || 0
              if (count === 0) return null
              return (
                <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {d.label} <span style={{ fontWeight: 600, color: d.color }}>{count}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Dial Calendar ──────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function DialCalendar() {
  const { data: tracker } = useQuery({
    queryKey: ['kpi-tracker'],
    queryFn: hermesClient.kpi.tracker,
    refetchInterval: 15_000,
  })

  const [hoveredDay, setHoveredDay] = useState<string | null>(null)

  if (!tracker) return null

  const history = tracker.history || []
  const historyMap = new Map<string, TrackerDayPoint>()
  for (const d of history) historyMap.set(d.day, d)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: { date: Date; dateStr: string; calls: number; convos: number; leads: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const point = historyMap.get(dateStr)
    days.push({
      date: d,
      dateStr,
      calls: point?.calls || 0,
      convos: point?.convos || 0,
      leads: point?.leads || 0,
    })
  }

  const CALL_TARGET = 300
  const totalCalls = days.reduce((s, d) => s + d.calls, 0)
  const totalPickups = days.reduce((s, d) => s + d.convos, 0)
  const totalLeads = days.reduce((s, d) => s + d.leads, 0)
  const activeDays = days.filter(d => d.calls > 0).length
  const targetHitDays = days.filter(d => d.calls >= CALL_TARGET).length

  const getIntensity = (calls: number) => {
    if (calls === 0) return 0
    if (calls >= CALL_TARGET) return 4
    if (calls >= CALL_TARGET * 0.6) return 3
    if (calls >= CALL_TARGET * 0.3) return 2
    return 1
  }

  const intensityColors = [
    'rgba(255,255,255,0.03)',
    '#6366f125',
    '#6366f145',
    '#6366f170',
    '#22c55e70',
  ]

  const intensityBorders = [
    'rgba(255,255,255,0.06)',
    '#6366f130',
    '#6366f150',
    '#6366f180',
    '#22c55e80',
  ]

  const hoveredData = hoveredDay ? days.find(d => d.dateStr === hoveredDay) : null

  const weeks: typeof days[] = []
  let currentWeek: typeof days = []
  const firstDow = days[0].date.getDay()
  for (let i = 0; i < firstDow; i++) currentWeek.push({ date: new Date(0), dateStr: '', calls: -1, convos: 0, leads: 0 })
  for (const d of days) {
    currentWeek.push(d)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16, padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Dial Calendar — Last 30 Days
          </div>
          <div style={{ fontSize: 11, color: '#475569' }}>
            {totalCalls.toLocaleString()} dials · {activeDays} active days · {targetHitDays} days at 300+
          </div>
        </div>
        {hoveredData && hoveredData.dateStr && (
          <div style={{
            background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#cbd5e1', textAlign: 'right',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {new Date(hoveredData.dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ color: '#6366f1' }}>{hoveredData.calls} dials</div>
            <div style={{ color: '#22c55e' }}>{hoveredData.convos} pickups</div>
            {hoveredData.leads > 0 && <div style={{ color: '#eab308' }}>{hoveredData.leads} interested</div>}
          </div>
        )}
      </div>

      {/* Calendar Grid */}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 22 }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{ height: 32, display: 'flex', alignItems: 'center', fontSize: 9, color: '#475569', width: 24 }}>
              {d}
            </div>
          ))}
        </div>
        {/* Weeks */}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {weeks.map((week, wi) => {
            const firstReal = week.find(d => d.dateStr)
            const monthLabel = firstReal && new Date(firstReal.dateStr + 'T12:00:00').getDate() <= 7
              ? MONTH_NAMES[new Date(firstReal.dateStr + 'T12:00:00').getMonth()]
              : ''
            return (
              <div key={wi} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ height: 18, fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center' }}>
                  {monthLabel}
                </div>
                {week.map((day, di) => {
                  if (day.calls < 0) return <div key={di} style={{ height: 32 }} />
                  const intensity = getIntensity(day.calls)
                  const isToday = day.dateStr === today.toISOString().split('T')[0]
                  return (
                    <div
                      key={di}
                      onMouseEnter={() => setHoveredDay(day.dateStr)}
                      onMouseLeave={() => setHoveredDay(null)}
                      style={{
                        height: 32, borderRadius: 6, cursor: 'pointer',
                        background: intensityColors[intensity],
                        border: `1px solid ${isToday ? '#6366f1' : intensityBorders[intensity]}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: day.calls >= 100 ? 10 : 11,
                        fontWeight: day.calls > 0 ? 600 : 400,
                        color: intensity >= 3 ? '#e2e8f0' : day.calls > 0 ? '#94a3b8' : '#334155',
                        transition: 'all 0.15s',
                        ...(isToday ? { boxShadow: '0 0 8px rgba(99,102,241,0.3)' } : {}),
                      }}
                    >
                      {day.calls > 0 ? day.calls : ''}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Intensity Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 9, color: '#475569' }}>Less</span>
        {intensityColors.map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c, border: `1px solid ${intensityBorders[i]}` }} />
        ))}
        <span style={{ fontSize: 9, color: '#475569' }}>300+</span>
      </div>

      {/* 30-Day Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>TOTAL DIALS</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}>{totalCalls.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>TOTAL PICKUPS</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{totalPickups}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>INTERESTED</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#eab308' }}>{totalLeads}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>AVG / ACTIVE DAY</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#818cf8' }}>{activeDays > 0 ? Math.round(totalCalls / activeDays) : 0}</div>
        </div>
      </div>
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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Pipeline Funnel (current)
      </div>
      {FUNNEL_STAGES.map((stage, i) => {
        const count = current[stage.key] || 0
        const width = Math.max(2, (count / maxVal) * 100)
        const prev = i > 0 ? (current[FUNNEL_STAGES[i - 1].key] || 0) : 0
        const convRate = prev > 0 ? Math.round((count / prev) * 100) : null

        return (
          <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 80, fontSize: 11, color: '#94a3b8', textAlign: 'right', flexShrink: 0 }}>
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
              <div style={{ width: 40, fontSize: 10, color: '#475569', textAlign: 'right', flexShrink: 0 }}>
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
  const { data: m } = useQuery({
    queryKey: ['kpi-calls'],
    queryFn: () => hermesClient.kpi.calls(7),
    refetchInterval: 30_000,
  })

  if (!m) return null

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <TrophyCard label="Total Dials" value={String(m.total_dials)} color="#6366f1"
        sub={`${m.unique_leads_called} unique leads`} icon="📞" />
      <TrophyCard label="Pickups" value={String(m.pickups)} color="#22c55e"
        sub={`${m.pickup_rate}% pickup rate`} icon="🤝" glow={m.pickups > 0} />
      <TrophyCard label="Voicemails" value={String(m.voicemails)} color="#a78bfa"
        sub={`${m.total_dials > 0 ? Math.round(m.voicemails / m.total_dials * 100) : 0}% of dials`} />
      <TrophyCard label="Bad Numbers" value={String(m.bad_numbers)} color="#ef4444"
        sub={`${m.total_dials > 0 ? Math.round(m.bad_numbers / m.total_dials * 100) : 0}% of dials`} />
      <TrophyCard label="Interested" value={String(m.interested)} color="#eab308"
        sub={`${m.interest_rate}% of pickups`} icon={m.interested > 0 ? '⭐' : undefined}
        glow={m.interested > 0} />
      <TrophyCard label="Pickup Rate" value={`${m.pickup_rate}%`} color={m.pickup_rate >= 5 ? '#22c55e' : '#f97316'}
        sub={`${m.pickups} / ${m.total_dials} dials`} />
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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Daily Activity
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: '3px 8px', borderRadius: 3, border: 'none', fontSize: 10, cursor: 'pointer',
                background: days === d ? '#6366f130' : 'rgba(255,255,255,0.06)', color: days === d ? '#818cf8' : '#666',
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
          <span style={{ fontSize: 10, color: '#64748b' }}>Calls</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 10, background: '#eab30880', borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#64748b' }}>Interested</span>
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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Source Performance
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Source', 'Total', 'Queued', 'Contacted', 'Interested', 'Pipeline', 'Won'].map(h => (
              <th key={h} style={{
                textAlign: h === 'Source' ? 'left' : 'right', padding: '6px 8px',
                fontSize: 10, color: '#475569', borderBottom: '1px solid rgba(255,255,255,0.06)', textTransform: 'uppercase',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((s: SourceRoi) => (
            <tr key={s.source}>
              <td style={{ padding: '8px', fontSize: 12, color: '#cbd5e1', borderBottom: '1px solid #0a0a12' }}>
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
      padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#cbd5e1', fontSize: 13 }}>{fu.address_full || fu.lead_id}</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>
            {fu.owner_name} &middot; {fu.follow_up_type}
            {fu.lead_status && <span style={{ marginLeft: 4, color: '#475569' }}>({fu.lead_status})</span>}
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
      {fu.notes && <div style={{ color: '#475569', fontSize: 11, marginTop: 6 }}>{fu.notes}</div>}
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
              background: 'rgba(255,255,255,0.06)', color: '#64748b', fontSize: 11, cursor: 'pointer',
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
    width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#cbd5e1', fontSize: 13,
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
                background: tab === t.key ? '#6366f130' : 'rgba(255,255,255,0.06)',
                color: tab === t.key ? '#818cf8' : '#666',
                fontWeight: tab === t.key ? 600 : 400,
              }}>{t.label}</button>
          ))}
        </div>
        <button onClick={() => setShowSchedule(!showSchedule)}
          style={{
            padding: '5px 12px', borderRadius: 4, border: 'none',
            background: showSchedule ? 'rgba(255,255,255,0.06)' : '#eab30818', color: showSchedule ? '#888' : '#eab308',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{showSchedule ? 'Cancel' : '+ Schedule'}</button>
      </div>

      {showSchedule && (
        <div style={{
          padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16, marginBottom: 12,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>Lead ID</label>
              <input value={fuLeadId} onChange={(e) => setFuLeadId(e.target.value)} placeholder="lead_id..." style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>Date</label>
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
          padding: 24, border: '1px dashed #2a2a3e', borderRadius: 16,
          textAlign: 'center', color: '#334155', fontSize: 13,
        }}>
          No follow-ups {tab === 'all' ? 'scheduled' : `for ${tab}`}.
        </div>
      )}
    </div>
  )
}

// ── Main KPI App ────────────────────────────────────────────

export function KpiApp() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  if (!isAdmin) {
    return <CallerKpiView userId={user?.id ?? 0} />
  }

  return <AdminKpiView />
}

function AdminKpiView() {
  const { data: kpi, error: kpiError } = useQuery({
    queryKey: ['kpi-summary'],
    queryFn: hermesClient.kpi.summary,
    refetchInterval: 15_000,
  })

  const k = kpi as KpiSummary | undefined

  return (
    <div>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>
        KPI Dashboard
      </h2>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
        Pipeline metrics, call performance, and follow-up management.
      </p>

      {/* Top-level metrics */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16, marginBottom: 24,
      }}>
        <TrophyCard label="Total Leads" value={kpiError ? '—' : String(k?.total_leads ?? 0)} color="#6366f1" icon="📋" />
        <TrophyCard label="Deals Closed" value={String(k?.deals_closed ?? 0)} color="#22c55e" icon="💰"
          glow={(k?.deals_closed ?? 0) > 0} />
        <TrophyCard label="Pipeline Value" value={`$${(k?.pipeline_value ?? 0).toLocaleString()}`} color="#eab308" icon="📈" />
        <TrophyCard label="Follow-Ups Due" value={String(k?.follow_ups_due ?? 0)} color="#ef4444" icon="⏰"
          glow={(k?.follow_ups_due ?? 0) > 0} />
      </div>

      {/* Dial Streak */}
      <DialStreakBanner />

      {/* Daily Tracker */}
      <DailyTracker />

      {/* Dial Calendar */}
      <DialCalendar />

      {/* Call metrics */}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        7-Day Call Stats
      </div>
      <CallMetricsRow />

      {/* Funnel + Chart side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ConversionFunnel />
        <DailyActivityChart />
      </div>

      {/* Source ROI */}
      <SourceRoiTable />

      {/* Follow-ups */}
      <h3 style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 12, marginTop: 8 }}>Follow-Ups</h3>
      <FollowUpSection />
    </div>
  )
}

// ── Caller KPI View ─────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function weekAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function CallerKpiView({ userId }: { userId: number }) {
  const queryClient = useQueryClient()
  const today = todayStr()

  const { data: activity } = useQuery<CallerActivity>({
    queryKey: ['caller-kpi-activity', userId, today],
    queryFn: () => hermesClient.activity.tracker(userId, today),
    refetchInterval: 30_000,
  })

  const [form, setForm] = useState({
    log_date: today, hours_claimed: '', dials_claimed: '', leads_set_claimed: '0', notes: '',
  })

  const { data: logs = [] } = useQuery({
    queryKey: ['daily-logs', weekAgoStr(), today, userId],
    queryFn: () => hermesClient.activity.dailyLogs(weekAgoStr(), today, userId),
  })

  const submitMutation = useMutation({
    mutationFn: (data: { log_date: string; hours_claimed: number; dials_claimed: number; leads_set_claimed: number; notes?: string }) =>
      hermesClient.activity.submitLog(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-logs'] })
      setForm({ log_date: today, hours_claimed: '', dials_claimed: '', leads_set_claimed: '0', notes: '' })
    },
  })

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, color: '#e2e8f0', fontSize: 13,
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>My Stats</h2>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
        Your call performance and daily log submission.
      </p>

      {/* Today's Stats */}
      {activity && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12, marginBottom: 24,
        }}>
          <TrophyCard label="Dials Today" value={String(activity.total_calls)} color="#6366f1" glow={activity.total_calls >= 300} />
          <TrophyCard label="Billable Hours" value={String(activity.billable_hours)} color="#22c55e" />
          <TrophyCard
            label="Active Time"
            value={`${Math.round(activity.active_minutes)} min`}
            color="#3b82f6"
          />
          <TrophyCard label="Dials/Hour" value={String(Math.round(activity.calls_per_hour))} color="#f59e0b" />
        </div>
      )}

      {/* Sessions */}
      {activity && activity.sessions.length > 0 && (
        <div style={{
          padding: 16, marginBottom: 24,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Today's Sessions
          </div>
          {activity.sessions.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
              borderBottom: i < activity.sessions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 6,
                background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                  {fmtTime(s.start)} — {fmtTime(s.end)}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {s.calls} calls &middot; {Math.round(s.duration_min)} min
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dispositions */}
      {activity && activity.total_calls > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24,
        }}>
          {Object.entries(activity.disposition_counts).sort((a, b) => b[1] - a[1]).map(([disp, count]) => {
            const colors: Record<string, { bg: string; text: string }> = {
              interested: { bg: 'rgba(34,197,94,0.1)', text: '#4ade80' },
              not_interested: { bg: 'rgba(239,68,68,0.1)', text: '#f87171' },
              bad_number: { bg: 'rgba(239,68,68,0.08)', text: '#ef4444' },
              voicemail: { bg: 'rgba(234,179,8,0.08)', text: '#eab308' },
              no_answer: { bg: 'rgba(100,116,139,0.1)', text: '#94a3b8' },
            }
            const c = colors[disp] ?? { bg: 'rgba(255,255,255,0.04)', text: '#64748b' }
            return (
              <div key={disp} style={{
                padding: '6px 12px', borderRadius: 8,
                background: c.bg, color: c.text,
                fontSize: 12, fontWeight: 600,
              }}>
                {disp.replace('_', ' ')} — {count}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Daily Log Form ── */}
      <div style={{
        padding: 20, marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))',
        border: '2px solid rgba(99,102,241,0.25)',
        borderRadius: 16,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#c7d2fe', marginBottom: 4 }}>
          Submit Your Daily Log
        </div>
        <div style={{ fontSize: 12, color: '#818cf8', marginBottom: 16 }}>
          Report your hours, dials, and leads at the end of your shift.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>Date</label>
            <input type="date" value={form.log_date} onChange={e => setForm(f => ({ ...f, log_date: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>Hours Worked</label>
            <input placeholder="e.g. 4" type="number" step="0.5" value={form.hours_claimed} onChange={e => setForm(f => ({ ...f, hours_claimed: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>Dials Made</label>
            <input placeholder="e.g. 300" type="number" value={form.dials_claimed} onChange={e => setForm(f => ({ ...f, dials_claimed: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>Leads Set</label>
            <input placeholder="0" type="number" value={form.leads_set_claimed} onChange={e => setForm(f => ({ ...f, leads_set_claimed: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 }}>Notes (optional)</label>
          <input placeholder="Anything to note about today's calls..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => submitMutation.mutate({
              log_date: form.log_date,
              hours_claimed: parseFloat(form.hours_claimed || '0'),
              dials_claimed: parseInt(form.dials_claimed || '0'),
              leads_set_claimed: parseInt(form.leads_set_claimed || '0'),
              notes: form.notes || undefined,
            })}
            disabled={!form.hours_claimed && !form.dials_claimed}
            style={{
              padding: '10px 24px', border: 'none', borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              opacity: !form.hours_claimed && !form.dials_claimed ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            {submitMutation.isPending ? 'Submitting...' : 'Submit Log'}
          </button>
        </div>
        {submitMutation.isSuccess && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
            Log submitted successfully.
          </div>
        )}
      </div>

      {/* Past Logs */}
      {logs.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Your Recent Logs
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {logs.map((l: any) => (
              <div key={l.id} style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{l.log_date}</span>
                  {l.notes && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 10 }}>{l.notes}</span>}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: '#22c55e' }}>{l.hours_claimed}h</span>
                  <span style={{ color: '#6366f1' }}>{l.dials_claimed} dials</span>
                  <span style={{ color: '#f59e0b' }}>{l.leads_set_claimed} leads</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
