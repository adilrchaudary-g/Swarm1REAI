import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Clock, Phone, AlertTriangle, CheckCircle, TrendingUp,
  ChevronLeft, ChevronRight, Shield, FileText, Eye, RefreshCw,
} from 'lucide-react'
import { hermesClient } from '../../api/hermes-client'
import { useAuthStore } from '../../store/auth-store'
import type { CallerActivity, ActivityDaySummary, IntegrityCallerReport } from '../../api/types'

type Section = 'tracker' | 'daily-log' | 'integrity'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function weekAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

export function ActivityApp() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [section, setSection] = useState<Section>('tracker')
  const [refreshing, setRefreshing] = useState(false)

  const tabs: { id: Section; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: 'tracker', label: 'Activity Tracker', icon: <Activity size={15} /> },
    { id: 'daily-log', label: 'Daily Log', icon: <FileText size={15} /> },
    { id: 'integrity', label: 'Integrity Check', icon: <Shield size={15} />, adminOnly: true },
  ]

  const visibleTabs = tabs.filter(t => !t.adminOnly || isAdmin)

  function handleRefresh() {
    setRefreshing(true)
    const keys: Record<Section, string[]> = {
      'tracker': ['activity-tracker', 'users', 'caller-live-status'],
      'daily-log': ['daily-logs'],
      'integrity': ['integrity', 'activity-summary'],
    }
    Promise.all(
      keys[section].map(k => queryClient.invalidateQueries({ queryKey: [k] }))
    ).finally(() => setTimeout(() => setRefreshing(false), 400))
  }

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Caller Activity Tracker</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Automated call tracking, self-reported logs, and integrity verification
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '7px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#94a3b8', fontSize: 12, fontWeight: 600,
            cursor: refreshing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: refreshing ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={14} style={{
            animation: refreshing ? 'spin 0.6s linear infinite' : 'none',
          }} />
          Refresh
        </button>
      </div>

      <CallerLiveStatus />

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, padding: 4, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
        {visibleTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 0', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: section === t.id ? 'rgba(99,102,241,0.12)' : 'transparent',
              color: section === t.id ? '#a5b4fc' : '#64748b',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {section === 'tracker' && <TrackerSection isAdmin={isAdmin} userId={user?.id ?? 0} />}
      {section === 'daily-log' && <DailyLogSection isAdmin={isAdmin} userId={user?.id ?? 0} />}
      {section === 'integrity' && isAdmin && <IntegritySection />}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes alertFlash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ── Caller Live Status Banner ────────────────────────────────────────

function CallerLiveStatus() {
  const { data: callers } = useQuery({
    queryKey: ['caller-live-status'],
    queryFn: () => hermesClient.activity.liveStatus(),
    refetchInterval: 30_000,
  })

  // Track which 30-min bracket was dismissed per caller
  const [dismissed, setDismissed] = useState<Record<number, number>>({})

  if (!callers || callers.length === 0) return null

  function formatInactive(mins: number | null): string {
    if (mins === null) return 'No calls recorded'
    if (mins < 60) return `Inactive ${Math.round(mins)} min`
    const hrs = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24)
      return `Inactive ${days}d ${hrs % 24}h`
    }
    return `Inactive ${hrs}h ${m}m`
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
      {callers.map(c => {
        const mins = c.inactive_minutes ?? 0
        const bracket = Math.floor(mins / 30)
        const isAlert = !c.active && mins >= 30 && bracket > (dismissed[c.user_id] ?? 0)

        const color = c.active ? '#22c55e' : isAlert ? '#ef4444' : '#eab308'
        const bg = c.active
          ? 'rgba(34,197,94,0.06)'
          : isAlert ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.06)'
        const borderColor = c.active
          ? 'rgba(34,197,94,0.25)'
          : isAlert ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.25)'

        function handleDismiss() {
          if (isAlert) {
            setDismissed(prev => ({ ...prev, [c.user_id]: bracket }))
          }
        }

        return (
          <div
            key={c.user_id}
            onClick={handleDismiss}
            style={{
              flex: 1, padding: '18px 22px', borderRadius: 14,
              background: bg,
              border: `2px solid ${borderColor}`,
              cursor: isAlert ? 'pointer' : 'default',
              animation: isAlert ? 'alertFlash 1.2s ease-in-out infinite' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color,
                boxShadow: c.active ? '0 0 8px rgba(34,197,94,0.5)'
                  : isAlert ? '0 0 10px rgba(239,68,68,0.6)' : 'none',
              }} />
              <span style={{ fontSize: 16, fontWeight: 700, color }}>{c.name}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                background: `${color}18`, color,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {c.active ? 'Active' : isAlert ? 'Alert' : 'Inactive'}
              </span>
              {isAlert && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
                  click to dismiss
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.active ? '#bbf7d0' : isAlert ? '#fca5a5' : '#fef08a' }}>
              {c.active
                ? `${c.today_dials} dials today`
                : formatInactive(c.inactive_minutes)
              }
            </div>
            {c.active && c.today_dials > 0 && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Last call {c.last_call ? fmtTime(c.last_call) : '—'}
              </div>
            )}
            {!c.active && c.today_dials > 0 && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {c.today_dials} dials before going inactive
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Activity Tracker (Timeline View) ─────────────────────────────────

function TrackerSection({ isAdmin, userId }: { isAdmin: boolean; userId: number }) {
  const [date, setDate] = useState(todayStr())
  const [selectedCaller, setSelectedCaller] = useState<number>(isAdmin ? 0 : userId)

  const { data: users = [] } = useQuery<Array<{ id: number; display_name: string; role: string }>>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${localStorage.getItem('swarm_token') || ''}` } })
      return res.ok ? res.json() : []
    },
    enabled: isAdmin,
  })

  const callers = users.filter(u => u.role === 'caller')
  const targetId = isAdmin ? (selectedCaller || (callers[0]?.id ?? 0)) : userId

  const { data: activity } = useQuery({
    queryKey: ['activity-tracker', targetId, date],
    queryFn: () => hermesClient.activity.tracker(targetId, date),
    enabled: targetId > 0,
  })

  const shiftDate = (days: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {isAdmin && callers.length > 0 && (
          <select
            value={selectedCaller || callers[0]?.id || ''}
            onChange={e => setSelectedCaller(parseInt(e.target.value))}
            style={selectStyle}
          >
            {callers.map(c => (
              <option key={c.id} value={c.id}>{c.display_name}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => shiftDate(-1)} style={navBtn}><ChevronLeft size={16} /></button>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 160, textAlign: 'center' }}>
            {dayLabel}
          </div>
          <button onClick={() => shiftDate(1)} style={navBtn}><ChevronRight size={16} /></button>
          <button
            onClick={() => setDate(todayStr())}
            style={{ ...navBtn, fontSize: 11, padding: '5px 10px' }}
          >
            Today
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {activity && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
          <StatCard label="Total Dials" value={activity.total_calls.toString()} icon={<Phone size={16} />} color="#6366f1" />
          <StatCard
            label="Billable Hours"
            value={activity.billable_hours.toString()}
            icon={<CheckCircle size={16} />}
            color="#22c55e"
            sub="100+ dials/hr"
          />
          <StatCard label="Active Time" value={`${fmt(activity.active_minutes)} min`} icon={<Clock size={16} />} color="#3b82f6" />
          <StatCard label="Dials/Hour" value={fmt(activity.calls_per_hour)} icon={<TrendingUp size={16} />} color="#f59e0b" />
          <StatCard
            label="Sessions"
            value={activity.sessions.length.toString()}
            icon={<Activity size={16} />}
            color="#8b5cf6"
            sub={activity.gaps.length > 0 ? `${activity.gaps.length} gap${activity.gaps.length > 1 ? 's' : ''}` : undefined}
          />
        </div>
      )}

      {/* Hourly Breakdown — Billable vs Non-Billable */}
      {activity && activity.hourly_breakdown && activity.hourly_breakdown.length > 0 && (
        <div style={{
          padding: 16, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
              Hourly Dial Count — 100 dials/hr minimum for pay
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#64748b' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(34,197,94,0.4)' }} /> Billable
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(239,68,68,0.3)' }} /> Not billable
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 100 }}>
            {activity.hourly_breakdown.map(h => {
              const maxDials = Math.max(...activity.hourly_breakdown.map(x => x.dials))
              const barHeight = maxDials > 0 ? (h.dials / maxDials) * 80 : 0
              return (
                <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: h.billable ? '#4ade80' : '#f87171',
                  }}>
                    {h.dials}
                  </div>
                  <div style={{
                    width: '100%', maxWidth: 40,
                    height: Math.max(4, barHeight),
                    borderRadius: 3,
                    background: h.billable
                      ? 'rgba(34,197,94,0.4)'
                      : 'rgba(239,68,68,0.3)',
                    border: `1px solid ${h.billable ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.4)'}`,
                  }} />
                  <div style={{ fontSize: 9, color: '#64748b' }}>
                    {h.hour > 12 ? h.hour - 12 : h.hour === 0 ? 12 : h.hour}{h.hour >= 12 ? 'p' : 'a'}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{
            marginTop: 8, height: 1,
            background: 'repeating-linear-gradient(to right, rgba(239,68,68,0.3) 0, rgba(239,68,68,0.3) 4px, transparent 4px, transparent 8px)',
          }}>
            <div style={{ fontSize: 9, color: '#f87171', textAlign: 'right', marginTop: 2 }}>100 dial minimum</div>
          </div>
        </div>
      )}

      {/* Timeline Strip */}
      {activity && activity.total_calls > 0 && (
        <div style={{
          padding: 16, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
            Activity Timeline — 5-minute intervals
          </div>
          <TimelineStrip activity={activity} />
        </div>
      )}

      {/* Sessions Detail */}
      {activity && activity.sessions.length > 0 && (
        <div style={{
          padding: 16, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
            Call Sessions (10min gap = new session)
          </div>
          {activity.sessions.map((s, i) => (
            <div key={i}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
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
                    {fmt(s.duration_min)} min &middot; {s.calls} calls &middot; {fmt(s.calls / Math.max(1, s.duration_min / 60))}/hr
                  </div>
                </div>
              </div>
              {activity.gaps[i] && (
                <div style={{
                  padding: '6px 12px 6px 40px', fontSize: 11,
                  color: activity.gaps[i].gap_minutes > 30 ? '#f87171' : '#eab308',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <AlertTriangle size={12} />
                  {fmt(activity.gaps[i].gap_minutes)} min gap
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Disposition Breakdown */}
      {activity && activity.total_calls > 0 && (
        <div style={{
          padding: 16, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
            Call Outcomes
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(activity.disposition_counts).sort((a, b) => b[1] - a[1]).map(([disp, count]) => (
              <div key={disp} style={{
                padding: '6px 12px', borderRadius: 8,
                background: dispColor(disp).bg, color: dispColor(disp).text,
                fontSize: 12, fontWeight: 600,
              }}>
                {disp.replace('_', ' ')} — {count}
              </div>
            ))}
          </div>
        </div>
      )}

      {activity && activity.total_calls === 0 && (
        <div style={{
          padding: 40, textAlign: 'center', color: '#475569', fontSize: 13,
          background: 'rgba(255,255,255,0.02)', borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          No call activity recorded for this day.
        </div>
      )}
    </div>
  )
}

function TimelineStrip({ activity }: { activity: CallerActivity }) {
  const hours = useMemo(() => {
    if (!activity.first_call || !activity.last_call) return { start: 8, end: 20 }
    const s = new Date(activity.first_call).getHours()
    const e = new Date(activity.last_call).getHours()
    return { start: Math.max(0, s - 1), end: Math.min(23, e + 2) }
  }, [activity])

  const bucketSlots: { key: string; hour: number; min: number }[] = []
  for (let h = hours.start; h <= hours.end; h++) {
    for (let m = 0; m < 60; m += 5) {
      bucketSlots.push({ key: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`, hour: h, min: m })
    }
  }

  return (
    <div>
      {/* Hour labels */}
      <div style={{ display: 'flex', marginBottom: 2 }}>
        {Array.from({ length: hours.end - hours.start + 1 }, (_, i) => hours.start + i).map(h => (
          <div key={h} style={{
            flex: 12, fontSize: 9, color: '#64748b', textAlign: 'left',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </div>
        ))}
      </div>
      {/* Bucket strip */}
      <div style={{ display: 'flex', gap: 1, height: 28, borderRadius: 4, overflow: 'hidden' }}>
        {bucketSlots.map(b => {
          const count = activity.buckets[b.key] || 0
          const intensity = count === 0 ? 0 : Math.min(1, count / 8)
          return (
            <div
              key={b.key}
              title={`${b.key} — ${count} call${count !== 1 ? 's' : ''}`}
              style={{
                flex: 1,
                background: count === 0
                  ? 'rgba(255,255,255,0.03)'
                  : `rgba(34,197,94,${0.15 + intensity * 0.6})`,
                borderLeft: b.min === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                cursor: 'default',
                transition: 'background 0.15s',
              }}
            />
          )
        })}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748b' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }} /> Inactive
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(34,197,94,0.3)' }} /> Low
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(34,197,94,0.75)' }} /> High
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#64748b' }}>
          {activity.first_call && <>First: {fmtTime(activity.first_call)}</>}
          {activity.last_call && <> &middot; Last: {fmtTime(activity.last_call)}</>}
        </div>
      </div>
    </div>
  )
}

// ── Daily Log (Self-reported) ────────────────────────────────────────

function DailyLogSection({ isAdmin, userId }: { isAdmin: boolean; userId: number }) {
  const queryClient = useQueryClient()
  const [dateRange] = useState({ from: weekAgoStr(), to: todayStr() })
  const [form, setForm] = useState({
    log_date: todayStr(), hours_claimed: '', dials_claimed: '', leads_set_claimed: '0', notes: '',
  })

  const { data: logs = [] } = useQuery({
    queryKey: ['daily-logs', dateRange.from, dateRange.to, isAdmin ? undefined : userId],
    queryFn: () => hermesClient.activity.dailyLogs(dateRange.from, dateRange.to, isAdmin ? undefined : userId),
  })

  const submitMutation = useMutation({
    mutationFn: (data: { log_date: string; hours_claimed: number; dials_claimed: number; leads_set_claimed: number; notes?: string }) =>
      hermesClient.activity.submitLog(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-logs'] })
      setForm({ log_date: todayStr(), hours_claimed: '', dials_claimed: '', leads_set_claimed: '0', notes: '' })
    },
  })

  return (
    <div>
      {/* Submit form (callers) */}
      {!isAdmin && (
        <div style={{
          padding: 16, marginBottom: 16,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe', marginBottom: 12 }}>
            Log Today's Activity
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 80px 80px 1fr', gap: 10, marginBottom: 10 }}>
            <input type="date" value={form.log_date} onChange={e => setForm(f => ({ ...f, log_date: e.target.value }))} style={inputStyle} />
            <input placeholder="Hours" type="number" step="0.5" value={form.hours_claimed} onChange={e => setForm(f => ({ ...f, hours_claimed: e.target.value }))} style={inputStyle} />
            <input placeholder="Dials" type="number" value={form.dials_claimed} onChange={e => setForm(f => ({ ...f, dials_claimed: e.target.value }))} style={inputStyle} />
            <input placeholder="Leads" type="number" value={form.leads_set_claimed} onChange={e => setForm(f => ({ ...f, leads_set_claimed: e.target.value }))} style={inputStyle} />
            <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} />
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
                padding: '8px 16px', border: 'none', borderRadius: 8,
                background: 'rgba(99,102,241,0.9)', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                opacity: !form.hours_claimed && !form.dials_claimed ? 0.5 : 1,
              }}
            >
              Submit Log
            </button>
          </div>
        </div>
      )}

      {/* Log history */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
        {isAdmin ? 'All Caller Logs' : 'Your Logs'} — Last 7 Days
      </div>

      {logs.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
          No logs submitted yet.
        </div>
      ) : (
        <div style={tableContainer}>
          {logs.map(l => (
            <div key={l.id} style={tableRow}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isAdmin && <span style={{ fontSize: 12, fontWeight: 600, color: '#a5b4fc' }}>{l.caller_name}</span>}
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{l.log_date}</span>
                </div>
                {l.notes && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{l.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: '#22c55e' }}>{l.hours_claimed}h</span>
                <span style={{ color: '#6366f1' }}>{l.dials_claimed} dials</span>
                <span style={{ color: '#f59e0b' }}>{l.leads_set_claimed} leads</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Integrity Check (Admin Only) ─────────────────────────────────────

function IntegritySection() {
  const [dateRange, setDateRange] = useState({ from: weekAgoStr(), to: todayStr() })
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: report } = useQuery({
    queryKey: ['integrity', dateRange.from, dateRange.to],
    queryFn: () => hermesClient.activity.integrity(dateRange.from, dateRange.to),
  })

  const { data: summaryData } = useQuery({
    queryKey: ['activity-summary', dateRange.from, dateRange.to, expanded],
    queryFn: () => hermesClient.activity.summary(dateRange.from, dateRange.to, expanded ?? undefined),
    enabled: expanded !== null,
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <input type="date" value={dateRange.from} onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))} style={{ ...inputStyle, width: 140 }} />
        <span style={{ color: '#64748b', fontSize: 12 }}>to</span>
        <input type="date" value={dateRange.to} onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))} style={{ ...inputStyle, width: 140 }} />
      </div>

      {report && report.callers.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
          No caller activity in this date range.
        </div>
      )}

      {report && report.callers.map(c => (
        <CallerIntegrityCard
          key={c.user_id}
          caller={c}
          expanded={expanded === c.user_id}
          onToggle={() => setExpanded(expanded === c.user_id ? null : c.user_id)}
          dayDetails={expanded === c.user_id ? summaryData ?? [] : []}
        />
      ))}
    </div>
  )
}

function CallerIntegrityCard({
  caller, expanded, onToggle, dayDetails,
}: {
  caller: IntegrityCallerReport
  expanded: boolean
  onToggle: () => void
  dayDetails: ActivityDaySummary[]
}) {
  const trustColor = caller.trust_score === null ? '#64748b'
    : caller.trust_score >= 85 ? '#22c55e'
    : caller.trust_score >= 60 ? '#eab308'
    : '#ef4444'

  return (
    <div style={{
      marginBottom: 12, borderRadius: 12,
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${caller.flagged_days > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)'}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '16px 18px', border: 'none', cursor: 'pointer',
          background: 'transparent', display: 'flex', alignItems: 'center', gap: 14,
          textAlign: 'left',
        }}
      >
        {/* Trust Score Circle */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          border: `3px solid ${trustColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: trustColor }}>
            {caller.trust_score !== null ? caller.trust_score : '—'}
          </span>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{caller.caller_name}</span>
            {caller.flagged_days > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: 'rgba(239,68,68,0.1)', color: '#f87171',
              }}>
                {caller.flagged_days} FLAGGED DAY{caller.flagged_days > 1 ? 'S' : ''}
              </span>
            )}
            {caller.logs_missing > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: 'rgba(234,179,8,0.1)', color: '#eab308',
              }}>
                {caller.logs_missing} MISSING LOG{caller.logs_missing > 1 ? 'S' : ''}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, display: 'flex', gap: 14, fontVariantNumeric: 'tabular-nums' }}>
            <span>{caller.total_days_active} day{caller.total_days_active !== 1 ? 's' : ''} active</span>
            <span>Actual: {caller.total_actual_dials} dials / {fmt(caller.total_actual_hours)}h</span>
            <span>Claimed: {caller.total_claimed_dials} dials / {fmt(caller.total_claimed_hours)}h</span>
          </div>
        </div>

        {/* Accuracy bars */}
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <AccuracyPill label="Hours" value={caller.hour_accuracy} />
          <AccuracyPill label="Dials" value={caller.dial_accuracy} />
        </div>

        <Eye size={16} style={{ color: '#64748b', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* Expanded day-by-day */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {dayDetails.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: '#64748b', textAlign: 'center' }}>Loading...</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['Date', 'Actual Dials', 'Claimed Dials', 'Billable Hrs', 'Claimed Hours', 'Leads', 'Flags'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayDetails.map(d => (
                    <tr key={d.call_date} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{d.call_date}</td>
                      <td style={{ padding: '8px 12px', color: '#6366f1', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.actual_dials}</td>
                      <td style={{ padding: '8px 12px', color: d.dials_claimed !== null ? '#94a3b8' : '#475569', fontVariantNumeric: 'tabular-nums' }}>
                        {d.dials_claimed ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>{d.billable_hours}h</span>
                        {d.non_billable_hours?.length > 0 && (
                          <span style={{ color: '#f87171', fontSize: 10, marginLeft: 4 }}>
                            ({d.non_billable_hours.length} below 100)
                          </span>
                        )}
                      </td>
                      <td style={{
                        padding: '8px 12px', fontVariantNumeric: 'tabular-nums',
                        color: d.hours_claimed !== null
                          ? (d.hours_claimed > d.billable_hours + 0.5 ? '#f87171' : '#94a3b8')
                          : '#475569',
                      }}>
                        {d.hours_claimed !== null ? `${d.hours_claimed}h` : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{d.actual_leads_set}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {d.integrity_flags.length === 0 ? (
                          <CheckCircle size={14} style={{ color: '#22c55e' }} />
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {d.integrity_flags.map(f => (
                              <span key={f} style={{
                                fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3,
                                background: flagColor(f).bg, color: flagColor(f).text,
                              }}>
                                {f.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AccuracyPill({ label, value }: { label: string; value: number | null }) {
  const pct = value !== null ? Math.round(value * 100) : null
  const color = pct === null ? '#64748b' : pct >= 85 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: 12, fontWeight: 700, color,
        padding: '2px 8px', borderRadius: 4,
        background: `${color}15`,
      }}>
        {pct !== null ? `${pct}%` : '—'}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: string; icon: React.ReactNode; color: string; sub?: string
}) {
  return (
    <div style={{
      padding: 14, borderRadius: 10,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `${color}15`, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function dispColor(d: string) {
  switch (d) {
    case 'interested': return { bg: 'rgba(34,197,94,0.1)', text: '#4ade80' }
    case 'not_interested': return { bg: 'rgba(239,68,68,0.1)', text: '#f87171' }
    case 'bad_number': return { bg: 'rgba(239,68,68,0.08)', text: '#ef4444' }
    case 'voicemail': return { bg: 'rgba(234,179,8,0.08)', text: '#eab308' }
    case 'no_answer': return { bg: 'rgba(100,116,139,0.1)', text: '#94a3b8' }
    case 'answered': return { bg: 'rgba(99,102,241,0.1)', text: '#a5b4fc' }
    default: return { bg: 'rgba(255,255,255,0.04)', text: '#64748b' }
  }
}

function flagColor(f: string) {
  switch (f) {
    case 'hours_exceed_billable': return { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' }
    case 'hours_inflated': return { bg: 'rgba(239,68,68,0.1)', text: '#f87171' }
    case 'dials_inflated': return { bg: 'rgba(239,68,68,0.1)', text: '#f87171' }
    case 'no_calls_found': return { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' }
    case 'below_100_dials_hr': return { bg: 'rgba(234,179,8,0.1)', text: '#eab308' }
    case 'no_log_submitted': return { bg: 'rgba(100,116,139,0.1)', text: '#94a3b8' }
    default: return { bg: 'rgba(255,255,255,0.04)', text: '#64748b' }
  }
}

// ── Shared Styles ────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  padding: '5px 8px', border: 'none', borderRadius: 6,
  background: 'rgba(255,255,255,0.04)', color: '#94a3b8',
  cursor: 'pointer', display: 'flex', alignItems: 'center',
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#e2e8f0', fontSize: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: '#e2e8f0', fontSize: 12,
  outline: 'none',
}

const tableContainer: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.04)',
  borderRadius: 12, overflow: 'hidden',
}

const tableRow: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  display: 'flex', alignItems: 'center', gap: 12,
}
