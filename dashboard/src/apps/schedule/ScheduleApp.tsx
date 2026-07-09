import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Clock, Check, X, Trash2 } from 'lucide-react'
import { hermesClient } from '../../api/hermes-client'
import { useAuthStore } from '../../store/auth-store'
import type { CallerAvailability, AvailabilityStatus } from '../../api/types'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtShort(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
}

function isToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function fmtTime12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')}${ampm}`
}

interface UserRecord {
  id: number
  username: string
  display_name: string
  role: string
  active: number
}

export function ScheduleApp() {
  const { isAdmin } = useAuthStore()
  return isAdmin() ? <AdminScheduleView /> : <CallerScheduleView />
}

// ── Caller View ──────────────────────────────────────────────────────

function CallerScheduleView() {
  const queryClient = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [editTimes, setEditTimes] = useState({ startTime: '09:00', endTime: '17:00' })

  const monday = useMemo(() => addDays(getMonday(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const dateFrom = fmtDate(days[0])
  const dateTo = fmtDate(days[6])

  const { data: availability = [] } = useQuery({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: () => hermesClient.schedule.mine(dateFrom, dateTo),
  })

  const saveMutation = useMutation({
    mutationFn: (entries: Array<{ date: string; status: string; start_time?: string; end_time?: string }>) =>
      hermesClient.schedule.save(entries),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (data: { date: string; start_time?: string }) =>
      hermesClient.schedule.delete(data.date, data.start_time),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  })

  const byDate = useMemo(() => {
    const map: Record<string, CallerAvailability[]> = {}
    for (const a of availability) {
      ;(map[a.date] ??= []).push(a)
    }
    return map
  }, [availability])

  function setStatus(date: string, status: AvailabilityStatus) {
    saveMutation.mutate([{ date, status }])
    setEditingDate(null)
  }

  function saveTimeSlot(date: string) {
    saveMutation.mutate([{ date, status: 'available', start_time: editTimes.startTime, end_time: editTimes.endTime }])
    setEditingDate(null)
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>My Schedule</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
          Set your availability for each day of the week
        </p>
      </div>

      <WeekNavigator
        monday={monday}
        days={days}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        onToday={() => setWeekOffset(0)}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 8,
        marginTop: 16,
      }}>
        {days.map((day, i) => {
          const dateStr = fmtDate(day)
          const entries = byDate[dateStr]
          const status = entries?.[0]?.status
          const today = isToday(day)
          const slots = entries?.filter(e => e.start_time) || []
          const isEditing = editingDate === dateStr

          const bg = status === 'available' ? 'rgba(34,197,94,0.08)' :
            status === 'unavailable' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)'
          const border = status === 'available' ? 'rgba(34,197,94,0.25)' :
            status === 'unavailable' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)'

          return (
            <div key={dateStr} style={{
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: 12,
              outline: today ? '2px solid rgba(99,102,241,0.4)' : 'none',
              outlineOffset: -1,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              {/* Header */}
              <div style={{ textAlign: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: today ? '#818cf8' : '#e2e8f0' }}>
                  {DAY_NAMES[i]}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{fmtShort(day)}</div>
              </div>

              {/* Status toggle — two clear buttons */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setStatus(dateStr, 'available')}
                  style={{
                    flex: 1,
                    padding: '10px 4px',
                    border: status === 'available' ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    background: status === 'available' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)',
                    color: status === 'available' ? '#4ade80' : '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <Check size={14} style={{ display: 'block', margin: '0 auto 3px' }} />
                  IN
                </button>
                <button
                  onClick={() => setStatus(dateStr, 'unavailable')}
                  style={{
                    flex: 1,
                    padding: '10px 4px',
                    border: status === 'unavailable' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    background: status === 'unavailable' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                    color: status === 'unavailable' ? '#f87171' : '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <X size={14} style={{ display: 'block', margin: '0 auto 3px' }} />
                  OFF
                </button>
              </div>

              {/* Time slots */}
              {slots.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {slots.map((s, si) => (
                    <div key={si} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', borderRadius: 6,
                      background: 'rgba(34,197,94,0.1)', fontSize: 12, color: '#22c55e', fontWeight: 600,
                    }}>
                      <Clock size={12} />
                      <span style={{ flex: 1 }}>{fmtTime12(s.start_time!)} – {fmtTime12(s.end_time!)}</span>
                      <button
                        onClick={() => deleteMutation.mutate({ date: dateStr, start_time: s.start_time! })}
                        style={{
                          background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
                          padding: 2, display: 'flex', borderRadius: 4,
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Set hours button */}
              {!isEditing && (
                <button
                  onClick={() => {
                    setEditingDate(dateStr)
                    setEditTimes({ startTime: '09:00', endTime: '17:00' })
                  }}
                  style={{
                    padding: '8px 0',
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 8,
                    color: '#a5b4fc',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                  }}
                >
                  <Clock size={14} />
                  Set Hours
                </button>
              )}

              {/* Time editor */}
              {isEditing && (
                <div style={{
                  padding: 10,
                  background: 'rgba(15,15,25,0.9)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="time"
                      value={editTimes.startTime}
                      onChange={e => setEditTimes(t => ({ ...t, startTime: e.target.value }))}
                      style={timeInput}
                    />
                    <span style={{ color: '#475569', fontSize: 12, lineHeight: '32px' }}>–</span>
                    <input
                      type="time"
                      value={editTimes.endTime}
                      onChange={e => setEditTimes(t => ({ ...t, endTime: e.target.value }))}
                      style={timeInput}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => saveTimeSlot(dateStr)} style={{
                      flex: 1, padding: '7px 0', border: 'none', borderRadius: 6,
                      background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}>
                      <Check size={14} /> Save
                    </button>
                    <button onClick={() => setEditingDate(null)} style={{
                      padding: '7px 12px', border: 'none', borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: 12,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 20, fontSize: 12, color: '#64748b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(34,197,94,0.3)', border: '1px solid rgba(34,197,94,0.5)' }} />
          Available
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(239,68,68,0.3)', border: '1px solid rgba(239,68,68,0.5)' }} />
          Not Available
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }} />
          Not Set
        </div>
      </div>
    </div>
  )
}

// ── Admin View ───────────────────────────────────────────────────────

function AdminScheduleView() {
  const queryClient = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [editingCell, setEditingCell] = useState<{ userId: number; date: string } | null>(null)
  const [editTimes, setEditTimes] = useState({ startTime: '09:00', endTime: '17:00' })

  const monday = useMemo(() => addDays(getMonday(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const dateFrom = fmtDate(days[0])
  const dateTo = fmtDate(days[6])

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${localStorage.getItem('swarm_token') || ''}` },
      })
      if (!res.ok) return []
      return res.json()
    },
  })

  const callers = useMemo(() => users.filter(u => u.role === 'caller' && u.active), [users])

  const { data: allAvailability = [] } = useQuery({
    queryKey: ['schedule-all', dateFrom, dateTo],
    queryFn: () => hermesClient.schedule.all(dateFrom, dateTo),
  })

  const saveMutation = useMutation({
    mutationFn: ({ entries, userId }: { entries: Array<{ date: string; status: string; start_time?: string; end_time?: string }>; userId: number }) =>
      hermesClient.schedule.save(entries, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule-all'] }),
  })

  const byUserDate = useMemo(() => {
    const map: Record<string, Record<string, CallerAvailability[]>> = {}
    for (const a of allAvailability) {
      const uid = String(a.user_id)
      ;(map[uid] ??= {})[a.date] ??= []
      map[uid][a.date].push(a)
    }
    return map
  }, [allAvailability])

  function cycleStatus(userId: number, dateStr: string) {
    const entries = byUserDate[String(userId)]?.[dateStr]
    const current = entries?.[0]?.status
    const next: AvailabilityStatus = !current ? 'available' : current === 'available' ? 'unavailable' : 'available'
    saveMutation.mutate({ entries: [{ date: dateStr, status: next }], userId })
  }

  function saveTimeSlot(userId: number, date: string) {
    saveMutation.mutate({
      entries: [{ date, status: 'available', start_time: editTimes.startTime, end_time: editTimes.endTime }],
      userId,
    })
    setEditingCell(null)
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Team Schedule</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
          View and manage all callers' weekly availability
        </p>
      </div>

      <WeekNavigator
        monday={monday}
        days={days}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        onToday={() => setWeekOffset(0)}
      />

      {callers.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 16 }}>
          No caller accounts yet. Add callers in Settings.
        </div>
      ) : (
        <div style={{
          marginTop: 16,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 12,
          overflow: 'visible',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px repeat(7, 1fr)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ padding: '14px 16px', fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Caller
            </div>
            {days.map((day, i) => (
              <div key={i} style={{
                padding: '10px 8px',
                textAlign: 'center',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: isToday(day) ? 700 : 600,
                  color: isToday(day) ? '#818cf8' : '#94a3b8',
                }}>
                  {DAY_NAMES[i]}
                </div>
                <div style={{
                  fontSize: 11, marginTop: 2,
                  color: isToday(day) ? '#818cf8' : '#64748b',
                }}>
                  {fmtShort(day)}
                </div>
              </div>
            ))}
          </div>

          {/* Caller rows */}
          {callers.map((caller, ci) => {
            const userData = byUserDate[String(caller.id)] || {}
            return (
              <div
                key={caller.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px repeat(7, 1fr)',
                  borderBottom: ci < callers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}
              >
                {/* Caller name */}
                <div style={{
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#fff',
                  }}>
                    {caller.display_name[0]?.toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                    {caller.display_name}
                  </span>
                </div>

                {/* Day cells */}
                {days.map((day, di) => {
                  const dateStr = fmtDate(day)
                  const entries = userData[dateStr]
                  const status = entries?.[0]?.status
                  const slots = entries?.filter(e => e.start_time) || []
                  const today = isToday(day)
                  const isEditing = editingCell?.userId === caller.id && editingCell?.date === dateStr

                  const cellBg = status === 'available' ? 'rgba(34,197,94,0.06)' :
                    status === 'unavailable' ? 'rgba(239,68,68,0.06)' : 'transparent'

                  return (
                    <div
                      key={di}
                      style={{
                        padding: '8px 6px',
                        background: cellBg,
                        borderLeft: today ? '2px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.04)',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        minHeight: 70,
                      }}
                    >
                      {/* Status toggle button — big, clear, centered */}
                      <button
                        onClick={() => cycleStatus(caller.id, dateStr)}
                        style={{
                          width: '100%',
                          padding: '6px 4px',
                          border: 'none',
                          borderRadius: 6,
                          background: status === 'available' ? 'rgba(34,197,94,0.15)'
                            : status === 'unavailable' ? 'rgba(239,68,68,0.15)'
                            : 'rgba(255,255,255,0.04)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: status === 'available' ? '#22c55e'
                            : status === 'unavailable' ? '#ef4444' : '#333',
                          boxShadow: status ? `0 0 8px ${status === 'available' ? '#22c55e' : '#ef4444'}40` : 'none',
                          border: status ? 'none' : '1px solid rgba(255,255,255,0.15)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {status === 'available' && <Check size={11} color="#fff" />}
                          {status === 'unavailable' && <X size={11} color="#fff" />}
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          color: status === 'available' ? '#4ade80'
                            : status === 'unavailable' ? '#f87171' : '#475569',
                        }}>
                          {status === 'available' ? 'IN' : status === 'unavailable' ? 'OFF' : 'Set'}
                        </span>
                      </button>

                      {/* Time slots */}
                      {slots.map((s, si) => (
                        <div key={si} style={{
                          fontSize: 10, color: '#22c55e', fontWeight: 600, lineHeight: 1.3,
                          background: 'rgba(34,197,94,0.08)', padding: '2px 5px', borderRadius: 4,
                          width: '100%', textAlign: 'center',
                        }}>
                          {fmtTime12(s.start_time!)}–{fmtTime12(s.end_time!)}
                        </div>
                      ))}

                      {!slots.length && status === 'available' && (
                        <span style={{ fontSize: 9, color: '#22c55e66' }}>All Day</span>
                      )}

                      {/* Set hours button */}
                      {!isEditing && (
                        <button
                          onClick={() => {
                            setEditingCell({ userId: caller.id, date: dateStr })
                            setEditTimes({ startTime: '09:00', endTime: '17:00' })
                          }}
                          style={{
                            width: '100%',
                            padding: '5px 4px',
                            border: '1px dashed rgba(99,102,241,0.25)',
                            borderRadius: 5,
                            background: 'rgba(99,102,241,0.05)',
                            color: '#818cf8',
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                            marginTop: 'auto',
                            transition: 'all 0.15s',
                          }}
                        >
                          <Clock size={11} /> Hours
                        </button>
                      )}

                      {/* Inline time editor popover */}
                      {isEditing && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          zIndex: 20,
                          width: 200,
                          padding: 12,
                          background: '#0f0f1a',
                          border: '1px solid rgba(99,102,241,0.35)',
                          borderRadius: 10,
                          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#a5b4fc', marginBottom: 8 }}>
                            Set Hours — {caller.display_name}
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            <input
                              type="time"
                              value={editTimes.startTime}
                              onChange={e => setEditTimes(t => ({ ...t, startTime: e.target.value }))}
                              style={timeInput}
                            />
                            <span style={{ color: '#475569', fontSize: 12, lineHeight: '32px' }}>–</span>
                            <input
                              type="time"
                              value={editTimes.endTime}
                              onChange={e => setEditTimes(t => ({ ...t, endTime: e.target.value }))}
                              style={timeInput}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => saveTimeSlot(caller.id, dateStr)} style={{
                              flex: 1, padding: '7px 0', border: 'none', borderRadius: 6,
                              background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            }}>
                              <Check size={14} /> Save
                            </button>
                            <button onClick={() => setEditingCell(null)} style={{
                              padding: '7px 12px', border: 'none', borderRadius: 6,
                              background: 'rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: 12,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 20, fontSize: 12, color: '#64748b', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#22c55e' }} />
          Available
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#ef4444' }} />
          Not Available
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#333', border: '1px solid rgba(255,255,255,0.15)' }} />
          Not Set
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
          Click status to toggle · Click "Hours" to set specific times
        </span>
      </div>
    </div>
  )
}

// ── Shared Components ────────────────────────────────────────────────

function WeekNavigator({ monday, days, onPrev, onNext, onToday }: {
  monday: Date; days: Date[]; onPrev: () => void; onNext: () => void; onToday: () => void
}) {
  const start = fmtShort(days[0])
  const end = fmtShort(days[6])
  const year = monday.getFullYear()
  const isCurrentWeek = days.some(isToday)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10,
    }}>
      <button onClick={onPrev} style={navBtn}><ChevronLeft size={18} /></button>
      <button onClick={onNext} style={navBtn}><ChevronRight size={18} /></button>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
          {start} — {end}
        </span>
        <span style={{ fontSize: 12, color: '#475569', marginLeft: 8 }}>{year}</span>
      </div>
      {!isCurrentWeek && (
        <button onClick={onToday} style={{
          ...navBtn, padding: '5px 14px', fontSize: 12, fontWeight: 600, width: 'auto',
        }}>
          Today
        </button>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, border: 'none', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)', color: '#94a3b8',
  cursor: 'pointer', flexShrink: 0,
}

const timeInput: React.CSSProperties = {
  flex: 1, padding: '6px 8px',
  background: '#0a0a12', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, color: '#e2e8f0', fontSize: 13,
}
