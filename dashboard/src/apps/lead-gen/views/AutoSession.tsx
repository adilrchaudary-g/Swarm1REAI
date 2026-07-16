import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hermesClient, type DialerSessionState } from '../../../api/hermes-client'

interface LeadLike {
  lead_id: string
  owner_name?: string
  address_full?: string | null
  address_street?: string | null
  mao?: number | null
  persona_primary?: string | null
  source?: string | null
  motivation_tier?: string | null
  motivation_score?: number | null
  callable_phones?: Array<{ phone_value: string; phone_type?: string }>
}

const TIER_COLORS: Record<string, string> = {
  HOT: '#ef4444', WARM: '#f97316', LUKEWARM: '#eab308', COLD: '#3b82f6', ICE: '#94a3b8',
  hot: '#ef4444', warm: '#f97316', lukewarm: '#eab308', cold: '#3b82f6', ice: '#94a3b8',
}

// The multi-line dialer needs the browser seated in the conference (audio leg) to
// hear whoever picks up — so we join/leave that session, not "arm" a device.
interface AutoDialerLike {
  isMockMode: boolean
  twilioReady: boolean
  twilioError: string | null
  isSessionActive: boolean
  joinSession: () => void
  leaveSession: () => void
}

interface Props {
  leads: LeadLike[]
  autoDialer: AutoDialerLike
  onExit: () => void
  scriptOpen?: boolean
  onToggleScript?: () => void
}

const DISPO_LABEL: Record<string, string> = {
  voicemail: 'Voicemail', no_answer: 'No Answer', bad_number: 'Bad Number',
  interested: 'Interested', not_interested: 'Not Interested', callback: 'Callback',
}
const DISPO_COLOR: Record<string, string> = {
  voicemail: '#64748b', no_answer: '#475569', bad_number: '#ef4444',
  interested: '#22c55e', not_interested: '#f59e0b', callback: '#38bdf8',
}
const fmtPhone = (p?: string | null) => {
  if (!p) return ''
  const d = p.replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

export function AutoSession({ leads, autoDialer, onExit, scriptOpen, onToggleScript }: Props) {
  const [started, setStarted] = useState(false)
  const [lines, setLines] = useState(5)
  const [note, setNote] = useState('')
  const lastLeadRef = useRef<string | null>(null)

  const leadById = useMemo(() => {
    const m = new Map<string, LeadLike>()
    for (const l of leads) m.set(l.lead_id, l)
    return m
  }, [leads])

  const queue = useMemo(
    () => leads
      .map((l) => ({ lead_id: l.lead_id, phone: l.callable_phones?.[0]?.phone_value || '', name: l.owner_name }))
      .filter((q) => q.lead_id && q.phone),
    [leads],
  )

  const { data: session } = useQuery<DialerSessionState>({
    queryKey: ['dialer-session'],
    queryFn: () => hermesClient.dialer.state(),
    enabled: started,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s && s !== 'stopped' && s !== 'idle' ? 1000 : false
    },
  })

  const status = session?.status ?? 'idle'
  const connected = session?.current ?? null
  const isConnected = status === 'connected' && !!connected
  const isPaused = status === 'paused' || session?.paused
  const sessionLost = started && status === 'idle'
  const inflight = session?.inflight ?? []
  const upNext = session?.up_next ?? []

  useEffect(() => {
    if (connected && connected.lead_id !== lastLeadRef.current) {
      lastLeadRef.current = connected.lead_id
      setNote('')
    }
    if (!connected) lastLeadRef.current = null
  }, [connected])

  const startMut = useMutation({
    mutationFn: () => hermesClient.dialer.start(queue, lines),
    onSuccess: () => setStarted(true),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not start the dialer'),
  })
  const pauseMut = useMutation({ mutationFn: () => hermesClient.dialer.pause() })
  const resumeMut = useMutation({ mutationFn: () => hermesClient.dialer.resume() })
  const linesMut = useMutation({ mutationFn: (n: number) => hermesClient.dialer.setLines(n) })
  const changeLines = (n: number) => { setLines(n); if (started) linesMut.mutate(n) }
  const activeLines = session?.lines ?? lines
  const dispoMut = useMutation({
    mutationFn: (d: string) => hermesClient.dialer.disposition(connected!.lead_id, d, note.trim() || undefined),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Disposition failed'),
  })

  function handleActivate() {
    if (queue.length === 0) { toast.error('No leads with phone numbers in this list'); return }
    if (autoDialer.isMockMode || !autoDialer.twilioReady) {
      toast('Connecting your audio… dialing will begin now', { icon: '🎧' })
    }
    autoDialer.joinSession()   // seat the agent's audio leg in the conference
    startMut.mutate()
  }
  function handleStop() {
    hermesClient.dialer.stop().catch(() => {})
    autoDialer.leaveSession()
    onExit()
  }

  const stats = session?.stats
  const done = session?.cursor ?? 0
  const total = session?.total ?? queue.length
  const remaining = session?.remaining ?? Math.max(0, total - done)

  return (
    <div style={{ padding: '8px 4px 24px', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#22c55e' }}>
          POWER DIALER
        </div>
        {/* Live line-count control — dial 3, 5, 8, or 10 at a time */}
        <div style={{ display: 'flex', gap: 3, background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, padding: 3 }}>
          {[3, 5, 8, 10].map((n) => {
            const on = activeLines === n
            return (
              <button key={n} onClick={() => changeLines(n)} title={`Dial ${n} at a time`}
                style={{ minWidth: 26, padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                         background: on ? '#22c55e' : 'transparent', color: on ? '#04140a' : '#94a3b8', border: 'none' }}>
                {n}
              </button>
            )
          })}
        </div>
        {started && !sessionLost && (
          <span style={{ color: '#334155', fontSize: 12 }}>{done} / {total} · {remaining} left</span>
        )}
        <div style={{ flex: 1 }} />
        {started && !sessionLost && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
            background: autoDialer.isSessionActive ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.08)',
            border: `1px solid ${autoDialer.isSessionActive ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.2)'}`,
            fontSize: 11, color: autoDialer.isSessionActive ? '#22c55e' : '#94a3b8',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: autoDialer.isSessionActive ? '#22c55e' : '#64748b' }} />
            {autoDialer.isSessionActive ? 'mic live' : 'seating…'}
          </span>
        )}
        {onToggleScript && (
          <button onClick={onToggleScript} title="Toggle call script"
            style={{ background: scriptOpen ? 'rgba(99,102,241,0.12)' : 'transparent',
                     border: `1px solid ${scriptOpen ? 'rgba(99,102,241,0.35)' : '#334155'}`,
                     color: scriptOpen ? '#a5b4fc' : '#94a3b8', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
            Script
          </button>
        )}
        <button onClick={handleStop}
          style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          End
        </button>
      </div>

      {/* Not started — pick lines + activate */}
      {!started && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ fontSize: 15, color: '#94a3b8', marginBottom: 6 }}>{queue.length} leads queued</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 460, margin: '0 auto 22px' }}>
            Dials several leads at once, drops you on the first person who picks up, and cancels the rest.
            Voicemails and no-answers are logged automatically.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 22, flexWrap: 'wrap' }}>
            {[3, 5, 8, 10].map((n) => (
              <button key={n} onClick={() => setLines(n)}
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                         background: lines === n ? 'rgba(34,197,94,0.14)' : 'transparent',
                         border: `1px solid ${lines === n ? 'rgba(34,197,94,0.4)' : '#334155'}`,
                         color: lines === n ? '#22c55e' : '#94a3b8' }}>
                {n} lines
              </button>
            ))}
          </div>
          <button onClick={handleActivate} disabled={startMut.isPending}
            style={{ background: '#22c55e', color: '#04140a', border: 'none', borderRadius: 12, padding: '16px 40px',
                     fontSize: 18, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 24px rgba(34,197,94,0.35)' }}>
            {startMut.isPending ? 'Starting…' : '▶  Activate Dialer'}
          </button>
          {autoDialer.twilioError && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 16 }}>{autoDialer.twilioError}</div>}
        </div>
      )}

      {sessionLost && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b', marginBottom: 8 }}>Session ended</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>The dialer server restarted and dropped this session. Just restart it.</div>
          <button onClick={() => { setStarted(false); handleActivate() }}
            style={{ background: '#22c55e', color: '#04140a', border: 'none', borderRadius: 12, padding: '14px 32px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
            ▶  Restart dialing
          </button>
        </div>
      )}

      {started && !sessionLost && (
        <>
          {/* ON THE LINE — the human who picked up (teleports to the top) */}
          {isConnected ? (
            <LiveCard lead={leadById.get(connected!.lead_id)} connected={connected!} note={note} setNote={setNote}
              onDispo={(d) => dispoMut.mutate(d)} disabled={dispoMut.isPending} />
          ) : (
            <div style={{ border: '1px solid #1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14,
                          background: '#0b1220', color: '#64748b', fontSize: 13, textAlign: 'center' }}>
              {status === 'completed'
                ? 'List complete 🎉 — every lead has been dialed.'
                : isPaused ? 'Paused' : 'Racing for a pickup — the first live person lands here.'}
            </div>
          )}

          {/* DIALING NOW — who's on each line right now */}
          <div style={{ fontSize: 11, color: '#475569', letterSpacing: 1, margin: '4px 0 8px' }}>
            DIALING NOW ({inflight.length}/{session?.lines ?? lines})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {inflight.length === 0 && !isConnected && (
              <div style={{ color: '#475569', fontSize: 12, padding: '4px 2px' }}>No lines ringing.</div>
            )}
            {inflight.map((f) => {
              const L = leadById.get(f.lead_id)
              const tier = TIER_COLORS[L?.motivation_tier || ''] || '#64748b'
              return (
                <div key={f.lead_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  background: '#0b1220', border: '1px solid #1e293b', borderRadius: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: '#eab308', animation: 'pulse 1s infinite' }} />
                  <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{f.name || L?.owner_name || 'Unknown'}</span>
                  {L?.motivation_tier && (
                    <span style={{ color: tier, fontSize: 11, fontWeight: 700 }}>{L.motivation_tier} {L.motivation_score ?? ''}</span>
                  )}
                  <span style={{ color: '#64748b', fontSize: 13, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{fmtPhone(f.phone)}</span>
                  <span style={{ color: '#eab308', fontSize: 12, fontWeight: 600, minWidth: 58, textAlign: 'right' }}>ringing…</span>
                </div>
              )
            })}
          </div>

          {/* UP NEXT — queue preview */}
          {upNext.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#475569', letterSpacing: 1, marginBottom: 8 }}>
                UP NEXT · {remaining} in queue
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {upNext.map((u) => (
                  <span key={u.lead_id} style={{ padding: '4px 10px', borderRadius: 8, background: '#0b1220',
                    border: '1px solid #16202e', color: '#94a3b8', fontSize: 12 }}>
                    {u.name || 'Unknown'}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Controls + stats */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {isPaused
              ? <button onClick={() => resumeMut.mutate()} style={ctrl('#22c55e')}>▶ Resume</button>
              : <button onClick={() => pauseMut.mutate()} disabled={isConnected}
                  style={{ ...ctrl('#f59e0b'), opacity: isConnected ? 0.4 : 1, cursor: isConnected ? 'not-allowed' : 'pointer' }}>⏸ Pause</button>}
          </div>
          {stats && (
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              <Stat label="Dialed" value={stats.dialed} />
              <Stat label="Connected" value={stats.connected} color="#22c55e" />
              <Stat label="Voicemail" value={stats.machine} />
              <Stat label="No Answer" value={stats.no_answer} />
              <Stat label="Bad" value={stats.bad} color="#ef4444" />
            </div>
          )}

          {/* Recently auto-logged (the red/dropped tail) */}
          {session?.feed && session.feed.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#475569', letterSpacing: 1, marginBottom: 8 }}>AUTO-LOGGED</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {[...session.feed].reverse().map((f, i) => (
                  <div key={`${f.lead_id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    padding: '6px 10px', background: '#0b1220', borderRadius: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: DISPO_COLOR[f.disposition] || '#475569' }} />
                    <span style={{ color: '#94a3b8', flex: 1 }}>{f.name || f.lead_id}</span>
                    <span style={{ color: DISPO_COLOR[f.disposition] || '#64748b', fontWeight: 600 }}>{DISPO_LABEL[f.disposition] || f.disposition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  )
}

function LiveCard({ lead, connected, note, setNote, onDispo, disabled }: {
  lead?: LeadLike; connected: { lead_id: string; name?: string | null; phone?: string }
  note: string; setNote: (v: string) => void; onDispo: (d: string) => void; disabled: boolean
}) {
  const tier = TIER_COLORS[lead?.motivation_tier || ''] || '#64748b'
  return (
    <div style={{ border: '2px solid #22c55e', borderRadius: 16, padding: 22, marginBottom: 16,
                  background: 'linear-gradient(180deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: '#22c55e', boxShadow: '0 0 12px #22c55e', animation: 'pulse 1s infinite' }} />
        <span style={{ color: '#22c55e', fontWeight: 800, letterSpacing: 1, fontSize: 13 }}>ON THE LINE — PICKED UP</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9' }}>{lead?.owner_name || connected.name || 'Unknown'}</span>
        {lead?.motivation_tier && <span style={{ color: tier, fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: '#1a1520' }}>{lead.motivation_tier} {lead.motivation_score ?? ''}</span>}
        <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{fmtPhone(connected.phone)}</span>
      </div>
      {(lead?.address_full || lead?.address_street) && <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>{lead?.address_full || lead?.address_street}</div>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 13 }}>
        {lead?.mao != null && <span><span style={{ color: '#475569' }}>MAO </span><span style={{ color: '#22c55e', fontWeight: 700 }}>${lead.mao.toLocaleString()}</span></span>}
        {lead?.persona_primary && <span><span style={{ color: '#475569' }}>Persona </span><span style={{ color: '#cbd5e1' }}>{lead.persona_primary}</span></span>}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes (optional)…"
        style={{ width: '100%', minHeight: 50, background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
                 borderRadius: 10, padding: 10, fontSize: 14, resize: 'vertical', margin: '14px 0' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <DispoBtn color="#22c55e" label="✓ Interested" onClick={() => onDispo('interested')} disabled={disabled} />
        <DispoBtn color="#f59e0b" label="Not Interested" onClick={() => onDispo('not_interested')} disabled={disabled} />
        <DispoBtn color="#38bdf8" label="Callback Later" onClick={() => onDispo('callback')} disabled={disabled} />
        <DispoBtn color="#ef4444" label="Bad / Wrong #" onClick={() => onDispo('bad_number')} disabled={disabled} />
      </div>
      <button onClick={() => onDispo('voicemail')} disabled={disabled}
        style={{ width: '100%', marginTop: 10, background: 'transparent', border: '1.5px solid #64748b', color: '#94a3b8',
                 borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 700, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
        📮 Voicemail / machine — skip to next
      </button>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 10, textAlign: 'center' }}>Pick an outcome to hang up and dial the next batch.</div>
    </div>
  )
}

function DispoBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: 'transparent', border: `1.5px solid ${color}`, color, borderRadius: 10, padding: '13px 12px',
               fontSize: 15, fontWeight: 700, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || '#cbd5e1' }}>{value}</div>
      <div>{label}</div>
    </div>
  )
}

function ctrl(color: string): React.CSSProperties {
  return { flex: 1, background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
}
