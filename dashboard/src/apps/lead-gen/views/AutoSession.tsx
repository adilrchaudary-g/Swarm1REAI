import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hermesClient, type PowerDialerState, type PowerDialerMetrics } from '../../../api/hermes-client'

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

// The slice of useAutoDialer this session needs. The server rings the agent's
// browser to seat them "warm" in the conference, so we ARM the device (accept
// incoming) rather than placing an outbound leg ourselves.
interface AutoDialerLike {
  isMockMode: boolean
  twilioReady: boolean
  twilioError: string | null
  isSessionActive: boolean
  armPowerDialer: () => void
  disarmPowerDialer: () => void
}

interface Props {
  leads: LeadLike[]
  autoDialer: AutoDialerLike
  onExit: () => void
  scriptOpen?: boolean
  onToggleScript?: () => void
}

export function AutoSession({ leads, autoDialer, onExit, scriptOpen, onToggleScript }: Props) {
  const [started, setStarted] = useState(false)
  const [note, setNote] = useState('')
  const lastLeadRef = useRef<string | null>(null)

  // Poll the agent's power-dialer state while running. The server owns the queue
  // and cadence — it dials whatever leads are queued in the DB, one leg at a time.
  const { data: state, refetch } = useQuery<PowerDialerState>({
    queryKey: ['pd-state'],
    queryFn: () => hermesClient.pd.state(),
    enabled: started,
    refetchInterval: (q) => (q.state.data?.status === 'idle' ? false : 1500),
  })

  // Session metrics (dials, connect rate, cost) — polled slower than state.
  const { data: metrics } = useQuery<PowerDialerMetrics>({
    queryKey: ['pd-metrics'],
    queryFn: () => hermesClient.pd.metrics(24),
    enabled: started,
    refetchInterval: 5000,
  })

  const status = state?.status ?? 'idle'
  const connected = state?.connected ?? null
  const isConnected = status === 'connected' && !!connected
  // We started the agent but the server reports idle — it likely restarted and
  // dropped the in-memory worker. Surface it instead of freezing on "dialing".
  const sessionLost = started && status === 'idle'

  // Reset the note field each time a new live lead connects.
  useEffect(() => {
    if (connected && connected.lead_id !== lastLeadRef.current) {
      lastLeadRef.current = connected.lead_id
      setNote('')
    }
    if (!connected) lastLeadRef.current = null
  }, [connected])

  const startMut = useMutation({
    mutationFn: () => hermesClient.pd.start(),
    onSuccess: () => setStarted(true),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not start the dialer'),
  })

  const dispoMut = useMutation({
    mutationFn: (code: string) => hermesClient.pd.disposition(code, note.trim() || undefined),
    onSuccess: () => { refetch() },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Disposition failed'),
  })

  function handleActivate() {
    // Dialing is server-side, but the agent only hears anyone once the browser is
    // seated in the conference — which needs a live Twilio device. Warn if the mic
    // isn't ready, but still start so the flow is testable in the simulator.
    if (autoDialer.isMockMode || !autoDialer.twilioReady) {
      toast('Connecting your audio… the dialer will seat you when a lead picks up', { icon: '🎧' })
    }
    autoDialer.armPowerDialer()
    startMut.mutate()
  }

  function handleStop() {
    hermesClient.pd.stop().catch(() => {})
    autoDialer.disarmPowerDialer()
    onExit()
  }

  // Enrich the live card from the queued lead (phones, extra fields) when present.
  const liveLead = connected ? leads.find((l) => l.lead_id === connected.lead_id) : undefined
  const tierColor = TIER_COLORS[(connected?.motivation_tier || liveLead?.motivation_tier) || ''] || '#64748b'

  return (
    <div style={{ padding: '8px 4px 24px', color: '#e2e8f0' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#22c55e' }}>
          POWER DIALER
        </div>
        <span style={{ color: '#334155', fontSize: 12 }}>
          one line · zero abandonment
        </span>
        <div style={{ flex: 1 }} />
        {started && !sessionLost && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4,
            padding: '4px 10px', borderRadius: 999,
            background: autoDialer.isSessionActive ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.08)',
            border: `1px solid ${autoDialer.isSessionActive ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.2)'}`,
            fontSize: 11, color: autoDialer.isSessionActive ? '#22c55e' : '#94a3b8',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999,
              background: autoDialer.isSessionActive ? '#22c55e' : '#64748b' }} />
            {autoDialer.isSessionActive ? 'mic live' : 'seating…'}
          </span>
        )}
        {onToggleScript && (
          <button onClick={onToggleScript}
            title="Toggle call script"
            style={{ background: scriptOpen ? 'rgba(99,102,241,0.12)' : 'transparent',
                     border: `1px solid ${scriptOpen ? 'rgba(99,102,241,0.35)' : '#334155'}`,
                     color: scriptOpen ? '#a5b4fc' : '#94a3b8',
                     borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
            Script
          </button>
        )}
        <button onClick={handleStop}
          style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                   borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          End Session
        </button>
      </div>

      {/* Not started yet */}
      {!started && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <div style={{ fontSize: 15, color: '#94a3b8', marginBottom: 8 }}>
            Ready to dial your queue
          </div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 480, margin: '0 auto 28px' }}>
            The dialer works your queued leads <b style={{ color: '#94a3b8' }}>one number at a time</b>,
            screens out voicemail and dead numbers automatically, and seats you the instant a
            <b style={{ color: '#94a3b8' }}> real person</b> picks up. No dropped calls — you only ever
            hear a live human.
          </div>
          <button onClick={handleActivate} disabled={startMut.isPending}
            style={{ background: '#22c55e', color: '#04140a', border: 'none', borderRadius: 12,
                     padding: '16px 40px', fontSize: 18, fontWeight: 800, cursor: 'pointer',
                     boxShadow: '0 4px 24px rgba(34,197,94,0.35)' }}>
            {startMut.isPending ? 'Starting…' : '▶  Activate Power Dialer'}
          </button>
          {autoDialer.twilioError && (
            <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 16 }}>{autoDialer.twilioError}</div>
          )}
        </div>
      )}

      {sessionLost && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b', marginBottom: 8 }}>
            Session ended
          </div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 420, margin: '0 auto 24px' }}>
            The dialer server restarted and dropped this session. Nothing was lost — just restart it.
          </div>
          <button onClick={() => { setStarted(false); handleActivate() }}
            style={{ background: '#22c55e', color: '#04140a', border: 'none', borderRadius: 12,
                     padding: '14px 32px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
            ▶  Restart dialing
          </button>
        </div>
      )}

      {started && !sessionLost && (
        <>
          {/* LIVE — connected to a human */}
          {isConnected ? (
            <div style={{ border: '2px solid #22c55e', borderRadius: 16, padding: 24,
                          background: 'linear-gradient(180deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02))',
                          marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: '#22c55e',
                               boxShadow: '0 0 12px #22c55e', animation: 'pulse 1s infinite' }} />
                <span style={{ color: '#22c55e', fontWeight: 800, letterSpacing: 1, fontSize: 13 }}>
                  LIVE — SOMEONE PICKED UP
                </span>
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9' }}>
                    {connected?.owner_name || liveLead?.owner_name || 'Unknown Owner'}
                  </span>
                  {(connected?.motivation_tier || liveLead?.motivation_tier) && (
                    <span style={{ color: tierColor, fontSize: 12, fontWeight: 700,
                                   padding: '2px 10px', borderRadius: 999, background: '#1a1520' }}>
                      {connected?.motivation_tier || liveLead?.motivation_tier}{' '}
                      {connected?.motivation_score ?? liveLead?.motivation_score ?? ''}
                    </span>
                  )}
                </div>
                {(connected?.address_full || liveLead?.address_full || liveLead?.address_street) && (
                  <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
                    {connected?.address_full || liveLead?.address_full || liveLead?.address_street}
                  </div>
                )}
                {liveLead?.callable_phones && liveLead.callable_phones.length > 0 && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>
                      {liveLead.callable_phones[0].phone_value}
                    </span>
                    {liveLead.callable_phones.length > 1 && (
                      <span style={{ color: '#475569', alignSelf: 'center' }}>
                        +{liveLead.callable_phones.length - 1} more #
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                  {(connected?.mao ?? liveLead?.mao) != null && (
                    <span><span style={{ color: '#475569' }}>MAO </span>
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>
                        ${(connected?.mao ?? liveLead?.mao)!.toLocaleString()}</span></span>
                  )}
                  {(connected?.persona_primary || liveLead?.persona_primary) && (
                    <span><span style={{ color: '#475569' }}>Persona </span>
                      <span style={{ color: '#cbd5e1' }}>{connected?.persona_primary || liveLead?.persona_primary}</span></span>
                  )}
                  {liveLead?.source && (
                    <span><span style={{ color: '#475569' }}>Source </span>
                      <span style={{ color: '#94a3b8' }}>{liveLead.source}</span></span>
                  )}
                </div>
              </div>

              <textarea value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Notes (optional)…"
                style={{ width: '100%', minHeight: 54, background: '#0b1220', color: '#e2e8f0',
                         border: '1px solid #1e293b', borderRadius: 10, padding: 10, fontSize: 14,
                         resize: 'vertical', marginBottom: 14 }} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <DispoButton color="#22c55e" label="✓ Interested"
                  onClick={() => dispoMut.mutate('interested')} disabled={dispoMut.isPending} />
                <DispoButton color="#f59e0b" label="Not Interested"
                  onClick={() => dispoMut.mutate('not_interested')} disabled={dispoMut.isPending} />
                <DispoButton color="#38bdf8" label="Callback Later"
                  onClick={() => dispoMut.mutate('callback')} disabled={dispoMut.isPending} />
                <DispoButton color="#ef4444" label="Wrong Number"
                  onClick={() => dispoMut.mutate('wrong_number')} disabled={dispoMut.isPending} />
              </div>
              {/* Escape hatch: AMD bridged a machine to you — log it and move on. */}
              <button onClick={() => dispoMut.mutate('voicemail')} disabled={dispoMut.isPending}
                style={{ width: '100%', marginTop: 10, background: 'transparent',
                         border: '1.5px solid #64748b', color: '#94a3b8', borderRadius: 10,
                         padding: '12px', fontSize: 14, fontWeight: 700,
                         cursor: dispoMut.isPending ? 'wait' : 'pointer',
                         opacity: dispoMut.isPending ? 0.5 : 1 }}>
                📮 Voicemail / machine — skip to next
              </button>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 12, textAlign: 'center' }}>
                Pick an outcome to hang up and auto-dial the next lead.
              </div>
            </div>
          ) : (
            /* Searching for a live pickup (server dialing one leg at a time) */
            <div style={{ border: '1px solid #1e293b', borderRadius: 16, padding: 32,
                          textAlign: 'center', marginBottom: 20, background: '#0b1220' }}>
              <div style={{ display: 'inline-flex', gap: 6, marginBottom: 14 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} style={{ width: 9, height: 9, borderRadius: 999, background: '#22c55e',
                    animation: `pulse 1.1s ${i * 0.18}s infinite` }} />
                ))}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0' }}>
                Dialing your queue — screening for a live person
              </div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                Voicemail and dead numbers are logged automatically. You'll be seated the
                moment someone real answers. Sit tight.
              </div>
            </div>
          )}

          {/* Session metrics (last 24h) */}
          {metrics && metrics.dials > 0 && (
            <>
              <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap',
                            marginBottom: 12, fontSize: 12, color: '#64748b' }}>
                <Stat label="Dialed" value={metrics.dials} />
                <Stat label="Connected" value={metrics.connects} color="#22c55e" />
                <Stat label="Connect rate" value={`${Math.round(metrics.connect_rate * 100)}%`} />
                <Stat label="Voicemail" value={metrics.outcomes.machine} />
                <Stat label="No answer" value={metrics.outcomes.no_answer} />
                <Stat label="Avg talk" value={fmtDur(metrics.avg_talk_seconds)} />
              </div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap',
                            fontSize: 11, color: '#475569' }}>
                <span>Dial cost <b style={{ color: '#64748b' }}>${metrics.est_dial_cost.toFixed(2)}</b></span>
                {metrics.connects > 0 && (
                  <span>≈ <b style={{ color: '#22c55e' }}>${metrics.cost_per_connect.toFixed(2)}</b>/connect</span>
                )}
                <span style={{ color: '#334155' }}>· last 24h · excludes your always-on line</span>
              </div>
            </>
          )}
        </>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </div>
  )
}

function fmtDur(seconds: number): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || '#cbd5e1' }}>{value}</div>
      <div>{label}</div>
    </div>
  )
}

function DispoButton({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: 'transparent', border: `1.5px solid ${color}`, color, borderRadius: 10,
               padding: '14px 12px', fontSize: 15, fontWeight: 700, cursor: disabled ? 'wait' : 'pointer',
               opacity: disabled ? 0.5 : 1, transition: 'all 0.15s' }}>
      {label}
    </button>
  )
}
