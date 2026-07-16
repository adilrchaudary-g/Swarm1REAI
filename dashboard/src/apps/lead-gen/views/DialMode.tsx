import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, X, ArrowLeft, ArrowRight, PhoneCall, AlertTriangle, PhoneIncoming, FileText, CheckCircle } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import { useAutoDialer } from '../hooks/useAutoDialer'
import { DialerModeToggle, CallStatusBar, AutoAdvanceCountdown, AutoDialPauseResume, SessionCostBar } from './AutoDialerControls'
import { AutoSession } from './AutoSession'
import type { Lead } from '../../../api/types'

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return raw
}

function toTelDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 ? `1${digits}` : digits
}

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

const TIER_COLORS: Record<string, string> = {
  HOT: '#ef4444', WARM: '#f97316', LUKEWARM: '#eab308', COLD: '#3b82f6', ICE: '#94a3b8',
  hot: '#ef4444', warm: '#f97316', lukewarm: '#eab308', cold: '#3b82f6', ice: '#94a3b8',
}

type Phase = 'idle' | 'answered' | 'no_answer' | 'interested' | 'schedule_fu' | 'set_confirm' | 'set_sent'

interface Props {
  leads: Lead[]
  onClose: () => void
}

export function DialMode({ leads, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [frozenLeads] = useState(() => [...leads])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [autoSession, setAutoSession] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [showDetail, setShowDetail] = useState(false)
  const [note, setNote] = useState('')
  const [fuDate, setFuDate] = useState('')
  const [setDate, setSetDate] = useState('')
  const [setTime, setSetTime] = useState('')
  const [setSending, setSetSending] = useState(false)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [voicemailIds, setVoicemailIds] = useState<string[]>([])
  const [lastBadNumberId, setLastBadNumberId] = useState<string | null>(null)
  const [phoneIndex, setPhoneIndex] = useState(0)
  const [callbackOpen, setCallbackOpen] = useState(false)
  const [callbackPhone, setCallbackPhone] = useState('')
  const [callbackLead, setCallbackLead] = useState<Lead | null>(null)
  const [callbackLoading, setCallbackLoading] = useState(false)
  const [callbackError, setCallbackError] = useState('')
  const [panelOpen, setPanelOpen] = useState(!isMobile)

  const autoDialer = useAutoDialer({ countdownSeconds: 3 })
  const pendingAutoDialRef = useRef(false)

  const MAX_ATTEMPTS = 6
  const { data: attemptCounts } = useQuery({
    queryKey: ['attempt-counts', frozenLeads.map(l => l.lead_id).join(',')],
    queryFn: async () => {
      const res = await fetch('/api/leads/attempt-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: frozenLeads.map(l => l.lead_id) }),
      })
      if (!res.ok) return {}
      return res.json() as Promise<Record<string, { total_attempts: number; last_called_at: string; bad_number_count: number }>>
    },
  })

  const queue = useMemo(() => {
    const main = frozenLeads.filter((l) => !skippedIds.has(l.lead_id) && !voicemailIds.includes(l.lead_id))
    const vm = voicemailIds
      .filter((id) => !skippedIds.has(id))
      .map((id) => frozenLeads.find((l) => l.lead_id === id))
      .filter(Boolean) as Lead[]
    return [...main, ...vm]
  }, [frozenLeads, skippedIds, voicemailIds])

  const lead = queue[currentIndex] ?? null
  const leadAttempts = attemptCounts?.[lead?.lead_id ?? '']?.total_attempts ?? 0
  const isOverDialed = leadAttempts >= MAX_ATTEMPTS
  const total = queue.length
  const hasNext = currentIndex < total - 1
  const totalPhones = lead?.callable_phones?.length ?? 0
  const activePhone = lead?.callable_phones?.[phoneIndex] ?? lead?.callable_phones?.[0] ?? null
  const rawPhone = activePhone?.phone_value || activePhone?.phone_digits || null
  const phone = rawPhone ? formatPhone(rawPhone) : null
  const telHref = rawPhone ? `tel:+${toTelDigits(rawPhone)}` : null

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue-all'] })
    queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    queryClient.invalidateQueries({ queryKey: ['kpi-summary'] })
  }, [queryClient])

  const updateStatus = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      hermesClient.leads.updateStatus(lead!.lead_id, status, reason),
    onSuccess: () => invalidate(),
  })

  const addNote = useMutation({
    mutationFn: () => hermesClient.leads.addNote(lead!.lead_id, 'call_note', note),
    onSuccess: () => invalidate(),
  })

  const archiveLead = useMutation({
    mutationFn: () => hermesClient.leads.archive(lead!.lead_id, 'Bad number'),
    onSuccess: () => invalidate(),
  })

  const scheduleFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(lead!.lead_id, 'callback', fuDate, note || undefined),
    onSuccess: async () => {
      await updateStatus.mutateAsync({ status: 'follow_up', reason: `Follow-up scheduled ${fuDate}` })
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  const undoBadNumber = useMutation({
    mutationFn: (leadId: string) =>
      hermesClient.leads.updateStatus(leadId, 'queued', 'Undo bad number — restored to queue'),
    onSuccess: () => invalidate(),
  })

  async function handleUndoBadNumber() {
    if (!lastBadNumberId) return
    const id = lastBadNumberId
    setLastBadNumberId(null)
    setSkippedIds((s) => { const next = new Set(s); next.delete(id); return next })
    await undoBadNumber.mutateAsync(id)
  }

  function advanceNext(skipLeadId?: string) {
    if (skipLeadId) {
      setSkippedIds((s) => new Set(s).add(skipLeadId))
    }
    setPhase('idle')
    setShowDetail(false)
    setNote('')
    setFuDate('')
    setSetDate('')
    setSetTime('')
    setSetSending(false)
    setPhoneIndex(0)
    if (hasNext) {
      setCurrentIndex((i) => i + 1)
    } else {
      setCurrentIndex(0)
    }
    if (autoDialer.dialerMode === 'auto') {
      pendingAutoDialRef.current = true
      autoDialer.onDispositionComplete()
    }
  }

  // Auto-dial: when countdown finishes and we're in auto mode, dial the current lead
  useEffect(() => {
    if (
      autoDialer.dialerMode === 'auto' &&
      autoDialer.autoDialState === 'idle' &&
      autoDialer.callStatus === 'ready' &&
      pendingAutoDialRef.current &&
      lead &&
      rawPhone
    ) {
      pendingAutoDialRef.current = false
      autoDialer.startCall(`+${toTelDigits(rawPhone)}`)
    }
  }, [autoDialer.autoDialState, autoDialer.callStatus, autoDialer.dialerMode, lead, rawPhone])

  // Auto-detect no-answer from Twilio: if call ended without ever being connected, pre-select no_answer phase
  useEffect(() => {
    if (autoDialer.dialerMode === 'auto' && autoDialer.callStatus === 'ended' && autoDialer.autoDialState === 'waiting_disposition') {
      if (autoDialer.callDurationAtEnd === 0) {
        setPhase('no_answer')
      } else {
        setPhase('answered')
      }
    }
  }, [autoDialer.callStatus, autoDialer.autoDialState, autoDialer.callDurationAtEnd, autoDialer.dialerMode])

  function logCall(disposition: string, notes?: string) {
    if (lead) hermesClient.leads.logCall(lead.lead_id, disposition, notes, rawPhone || undefined).catch(() => {})
  }

  function handleAnswered() { setLastBadNumberId(null); setPhase('answered') }

  function handleNoAnswer() {
    setLastBadNumberId(null)
    setPhase('no_answer')
  }

  function handleInterested() {
    setPhase('interested')
  }

  async function handleNotInterested() {
    const id = lead!.lead_id
    setLastBadNumberId(null)
    logCall('not_interested')
    await updateStatus.mutateAsync({ status: 'not_interested', reason: 'Not interested — dial time' })
    advanceNext(id)
  }

  async function handleBadNumber() {
    const id = lead!.lead_id
    logCall('bad_number')
    if (phoneIndex < totalPhones - 1) {
      setPhoneIndex((i) => i + 1)
      setPhase('idle')
      return
    }
    await archiveLead.mutateAsync()
    setLastBadNumberId(id)
    advanceNext(id)
  }

  async function handleVoicemail() {
    const id = lead!.lead_id
    setLastBadNumberId(null)
    logCall('voicemail')
    if (phoneIndex < totalPhones - 1) {
      setPhoneIndex((i) => i + 1)
      setPhase('idle')
      return
    }
    await updateStatus.mutateAsync({ status: 'contacted', reason: 'Voicemail — will retry' })
    setVoicemailIds((ids) => [...ids.filter((v) => v !== id), id])
    setPhase('idle')
    setShowDetail(false)
    setNote('')
    setFuDate('')
    setPhoneIndex(0)
    if (hasNext) setCurrentIndex((i) => i + 1)
    else setCurrentIndex(0)
  }

  async function handleSaveInterested() {
    if (note.trim()) await addNote.mutateAsync()
    logCall('interested', note.trim() || undefined)
    await updateStatus.mutateAsync({ status: 'interested', reason: 'Interested — dial time' })
    setPhase('schedule_fu')
  }

  async function handleConfirmSet() {
    if (!lead || !setDate || !setTime) return
    setSetSending(true)
    const appointmentAt = `${setDate}T${setTime}:00`
    await hermesClient.leads.confirmSet(lead.lead_id, appointmentAt, note.trim() || undefined, rawPhone || undefined)
    invalidate()
    setSetSending(false)
    setPhase('set_sent')
  }

  async function handleSaveFollowUp() {
    const id = lead!.lead_id
    if (fuDate) {
      await scheduleFollowUp.mutateAsync()
    }
    advanceNext(id)
  }

  function handleSkipFollowUp() {
    advanceNext(lead!.lead_id)
  }

  async function handleCallbackLookup() {
    const digits = callbackPhone.replace(/\D/g, '')
    if (digits.length < 10) {
      setCallbackError('Enter a full phone number')
      return
    }
    setCallbackLoading(true)
    setCallbackError('')
    const result = await hermesClient.leads.lookupByPhone(digits)
    setCallbackLoading(false)
    if (result) {
      setCallbackLead(result)
      setCallbackOpen(false)
    } else {
      setCallbackError('No lead found for that number')
    }
  }

  const mobBtn: React.CSSProperties = isMobile
    ? { minHeight: 48, fontSize: 15 }
    : {}

  // Auto-dialer takes over the whole surface with its own server-driven session.
  if (autoSession) {
    return (
      <Overlay onClose={() => { setAutoSession(false); onClose() }} isMobile={isMobile} rightPanel={
        !isMobile && panelOpen ? <ScriptPanel onClose={() => setPanelOpen(false)} /> : undefined
      }>
        <AutoSession
          leads={queue}
          autoDialer={autoDialer}
          onExit={() => setAutoSession(false)}
          scriptOpen={!isMobile && panelOpen}
          onToggleScript={!isMobile ? () => setPanelOpen((o) => !o) : undefined}
        />
      </Overlay>
    )
  }

  if (!lead) {
    return (
      <Overlay onClose={onClose} isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 24, color: '#22c55e', marginBottom: 12 }}>All Caught Up</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>No more leads in the queue.</div>
          <button onClick={onClose} style={{ ...btn, ...mobBtn, background: '#6366f1', color: '#fff', marginTop: 20, padding: '10px 24px' }}>
            Close
          </button>
        </div>
      </Overlay>
    )
  }

  const tierColor = TIER_COLORS[lead.motivation_tier || ''] || '#666'

  return (
    <Overlay onClose={onClose} isMobile={isMobile} rightPanel={
      !isMobile && panelOpen ? <ScriptPanel onClose={() => setPanelOpen(false)} /> : undefined
    }>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: autoDialer.dialerMode === 'auto' ? '#22c55e' : '#6366f1', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
            {autoDialer.dialerMode === 'auto' ? 'POWER DIAL' : 'DIAL TIME'}
          </div>
          <span style={{ color: '#334155', fontSize: 12 }}>{currentIndex + 1} / {total}</span>
          <DialerModeToggle
            mode={autoSession ? 'auto' : 'manual'}
            onToggle={(m) => setAutoSession(m === 'auto')}
            twilioAvailable={autoDialer.twilioReady || autoDialer.twilioInitializing}
          />
          {autoDialer.dialerMode === 'auto' && (
            <AutoDialPauseResume
              isPaused={autoDialer.isPaused}
              onToggle={autoDialer.togglePause}
              queuePosition={currentIndex + 1}
              queueTotal={total}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isMobile && (
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: panelOpen ? '#6366f120' : '#1a1a2e',
                border: `1px solid ${panelOpen ? '#6366f140' : '#1e1e2e'}`,
                borderRadius: 6, padding: '5px 10px',
                color: panelOpen ? '#a5b4fc' : '#64748b',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <FileText size={13} />
              Script
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', padding: 8 }}><X size={20} /></button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#16162a', borderRadius: 2, marginBottom: 20 }}>
        <div style={{ height: '100%', background: '#6366f1', borderRadius: 2, width: `${((currentIndex + 1) / total) * 100}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Call Status Bar — auto mode only */}
      {autoDialer.dialerMode === 'auto' && autoDialer.callStatus !== 'ready' && (
        <CallStatusBar
          callStatus={autoDialer.callStatus}
          elapsedSeconds={autoDialer.elapsedSeconds}
          isMuted={autoDialer.isMuted}
          isMockMode={autoDialer.isMockMode}
          onMute={autoDialer.toggleMute}
          onHangUp={autoDialer.hangUp}
          leadName={lead.owner_name}
          leadAddress={lead.address_full || lead.address_street || null}
          phoneNumber={phone}
          isMobile={isMobile}
        />
      )}

      {isOverDialed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 12, borderRadius: 8,
          background: '#271118', border: '1px solid #3a1a1a',
          color: '#ef4444', fontSize: 12,
        }}>
          <AlertTriangle size={14} />
          <span>This lead has been called {leadAttempts} times with no progress. Consider skipping.</span>
        </div>
      )}

      {/* Lead card */}
      <div style={{ background: '#0d0d14', border: '1px solid #1e1e2e', borderRadius: 10, padding: isMobile ? 16 : 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: isMobile ? 16 : 18, fontWeight: 600, marginBottom: 4 }}>
              <span>{lead.owner_name || 'Unknown Owner'}</span>
              {leadAttempts > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '2px 7px', borderRadius: 10,
                  background: isOverDialed ? '#271118' : '#1e1e2e',
                  fontSize: 11, fontWeight: 700,
                  color: isOverDialed ? '#ef4444' : '#94a3b8',
                }}>
                  {isOverDialed && <AlertTriangle size={10} />}
                  {leadAttempts}x called
                </span>
              )}
              {totalPhones > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 10,
                  background: '#1e1e2e', fontSize: 12, fontWeight: 700,
                  color: phoneIndex < totalPhones - 1 ? '#6366f1' : '#ef4444',
                }}>
                  <Phone size={11} />
                  {phoneIndex + 1}/{totalPhones}
                </span>
              )}
            </div>
            <div style={{ color: '#94a3b8', fontSize: isMobile ? 13 : 14, marginBottom: 8 }}>
              {lead.address_full || lead.address_street || '—'}
            </div>
          </div>
          <span style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            color: tierColor, background: '#1a1520', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {lead.motivation_tier} {lead.motivation_score ?? ''}
          </span>
        </div>

        {/* Phone number — auto mode shows Dial button, manual mode keeps tel: link */}
        {autoDialer.dialerMode === 'auto' ? (
          rawPhone ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: isMobile ? '14px 16px' : '10px 14px',
              background: '#111119', borderRadius: 14, marginBottom: 12,
            }}>
              <Phone size={18} color="#22c55e" />
              <span style={{
                color: '#e2e8f0', fontSize: isMobile ? 24 : 22, fontWeight: 700, letterSpacing: 1, flex: 1,
              }}>
                {phone}
              </span>
              {totalPhones > 1 && (
                <span style={{ color: '#6366f1', fontSize: 12, fontWeight: 700 }}>
                  ({phoneIndex + 1}/{totalPhones})
                </span>
              )}
              {autoDialer.callStatus === 'ready' && autoDialer.autoDialState !== 'countdown' && (
                <button
                  onClick={() => {
                    pendingAutoDialRef.current = false
                    autoDialer.startCall(`+${toTelDigits(rawPhone)}`)
                  }}
                  style={{
                    ...btn, background: '#22c55e', color: '#fff',
                    padding: '8px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                  }}
                >
                  Dial
                </button>
              )}
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', background: '#12121c', borderRadius: 6, marginBottom: 12,
            }}>
              <Phone size={18} color="#ef4444" />
              <span style={{ color: '#ef4444', fontSize: isMobile ? 18 : 22, fontWeight: 700 }}>
                No phone on file
              </span>
            </div>
          )
        ) : telHref ? (
          <a
            href={telHref}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: isMobile ? '14px 16px' : '10px 14px',
              background: isMobile ? '#0f2a1a' : '#111119',
              border: isMobile ? '1px solid #1a3d2a' : 'none',
              borderRadius: 14, marginBottom: 12,
              textDecoration: 'none', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {isMobile ? <PhoneCall size={22} color="#22c55e" /> : <Phone size={18} color="#22c55e" />}
            <span style={{
              color: '#e2e8f0', fontSize: isMobile ? 24 : 22, fontWeight: 700, letterSpacing: 1, flex: 1,
            }}>
              {phone}
            </span>
            {totalPhones > 1 && (
              <span style={{ color: '#6366f1', fontSize: 12, fontWeight: 700 }}>
                ({phoneIndex + 1}/{totalPhones})
              </span>
            )}
            {isMobile && (
              <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>TAP TO CALL</span>
            )}
            {activePhone?.phone_type && !isMobile && (
              <span style={{ color: '#475569', fontSize: 11 }}>
                ({activePhone.phone_type})
              </span>
            )}
          </a>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', background: '#12121c', borderRadius: 6, marginBottom: 12,
          }}>
            <Phone size={18} color="#ef4444" />
            <span style={{ color: '#ef4444', fontSize: isMobile ? 18 : 22, fontWeight: 700 }}>
              No phone on file
            </span>
          </div>
        )}

        {/* Quick stats row */}
        <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
          {lead.arv_estimate && (
            <div><span style={{ color: '#475569' }}>ARV </span><span style={{ color: '#cbd5e1' }}>${lead.arv_estimate.toLocaleString()}</span></div>
          )}
          {lead.mao && (
            <div><span style={{ color: '#475569' }}>MAO </span><span style={{ color: '#22c55e' }}>${lead.mao.toLocaleString()}</span></div>
          )}
          {lead.persona_primary && (
            <div><span style={{ color: '#475569' }}>Persona </span><span style={{ color: '#cbd5e1' }}>{lead.persona_primary}</span></div>
          )}
          {lead.source && (
            <div><span style={{ color: '#475569' }}>Source </span><span style={{ color: '#94a3b8' }}>{lead.source}</span></div>
          )}
        </div>
      </div>

      {/* View Details toggle */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        style={{ ...btn, ...mobBtn, background: '#171833', color: '#a5b4fc', width: '100%', marginBottom: 12, padding: isMobile ? '12px 0' : '8px 0', fontSize: isMobile ? 14 : 12, border: '1px solid #1c1c3f', borderRadius: 8 }}
      >
        {showDetail ? 'Hide Details' : 'View Details'}
      </button>

      {(updateStatus.isError || addNote.isError || archiveLead.isError || scheduleFollowUp.isError) && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {updateStatus.isError && `Update failed: ${updateStatus.error instanceof Error ? updateStatus.error.message : String(updateStatus.error)}`}
          {addNote.isError && `Note failed: ${addNote.error instanceof Error ? addNote.error.message : String(addNote.error)}`}
          {archiveLead.isError && `Archive failed: ${archiveLead.error instanceof Error ? archiveLead.error.message : String(archiveLead.error)}`}
          {scheduleFollowUp.isError && `Follow-up failed: ${scheduleFollowUp.error instanceof Error ? scheduleFollowUp.error.message : String(scheduleFollowUp.error)}`}
        </div>
      )}

      {showDetail && <DetailExpand lead={lead} isMobile={isMobile} />}

      {/* Action buttons — phase-dependent */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleAnswered} style={{ ...btn, ...mobBtn, flex: 1, background: '#22c55e', color: '#fff', padding: '12px 0', fontSize: 14, fontWeight: 700 }}>
            Answered
          </button>
          <button onClick={handleNoAnswer} style={{ ...btn, ...mobBtn, flex: 1, background: '#ef4444', color: '#fff', padding: '12px 0', fontSize: 14, fontWeight: 700 }}>
            No Answer
          </button>
        </div>
      )}

      {phase === 'no_answer' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleVoicemail} style={{ ...btn, ...mobBtn, flex: 1, background: '#261f11', color: '#eab308', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
            Voicemail
          </button>
          <button onClick={handleBadNumber} style={{ ...btn, ...mobBtn, flex: 1, background: '#271118', color: '#ef4444', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
            Bad Number
          </button>
          {phoneIndex < totalPhones - 1 ? (
            <button onClick={() => { setPhoneIndex((i) => i + 1); setPhase('idle') }} style={{ ...btn, ...mobBtn, flex: 1, background: '#1a1a2e', color: '#6366f1', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
              Next Number
            </button>
          ) : (
            <button onClick={() => advanceNext()} style={{ ...btn, ...mobBtn, flex: 1, background: '#1a1a2e', color: '#6366f1', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
              Next Lead
            </button>
          )}
          <button onClick={() => setPhase('idle')} style={{ ...btn, ...mobBtn, background: '#23232a', color: '#94a3b8', padding: '12px 16px', fontSize: 12 }}>
            Back
          </button>
        </div>
      )}

      {phase === 'answered' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleInterested} style={{ ...btn, ...mobBtn, flex: 1, background: '#0d211c', color: '#22c55e', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
            Interested
          </button>
          <button onClick={handleNotInterested} style={{ ...btn, ...mobBtn, flex: 1, background: '#271118', color: '#ef4444', padding: '12px 0', fontSize: 13, fontWeight: 600 }}>
            Not Interested
          </button>
          <button onClick={() => { logCall('wrong_number'); handleBadNumber() }} style={{ ...btn, ...mobBtn, background: '#1a1a2e', color: '#f97316', padding: '12px 14px', fontSize: 11 }}>
            Wrong Number
          </button>
          <button onClick={() => setPhase('idle')} style={{ ...btn, ...mobBtn, background: '#23232a', color: '#94a3b8', padding: '12px 16px', fontSize: 12 }}>
            Back
          </button>
        </div>
      )}

      {phase === 'interested' && (
        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notes from the call..."
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', background: '#0a0a12', border: '1px solid #1e1e2e',
              borderRadius: 6, color: '#cbd5e1', fontSize: isMobile ? 16 : 13, resize: 'vertical', marginBottom: 10, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPhase('set_confirm')} style={{ ...btn, ...mobBtn, flex: 1, background: '#22c55e', color: '#fff', padding: '10px 0', fontSize: 13, fontWeight: 600 }}>
              Set
            </button>
            <button onClick={handleSaveInterested} style={{ ...btn, ...mobBtn, flex: 1, background: '#1a1a2e', color: '#eab308', padding: '10px 0', fontSize: 13, fontWeight: 600 }}>
              Save & Schedule Follow-Up
            </button>
            <button onClick={() => setPhase('answered')} style={{ ...btn, ...mobBtn, background: '#23232a', color: '#94a3b8', padding: '10px 16px', fontSize: 12 }}>
              Back
            </button>
          </div>
        </div>
      )}

      {phase === 'set_confirm' && (
        <div>
          <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Book the Appointment
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>Date</label>
              <input
                type="date"
                value={setDate}
                onChange={(e) => setSetDate(e.target.value)}
                style={{
                  width: '100%', padding: isMobile ? '12px 10px' : '8px 10px', background: '#0a0a12', border: '1px solid #1e1e2e',
                  borderRadius: 4, color: '#cbd5e1', fontSize: isMobile ? 16 : 13, boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>Time</label>
              <input
                type="time"
                value={setTime}
                onChange={(e) => setSetTime(e.target.value)}
                style={{
                  width: '100%', padding: isMobile ? '12px 10px' : '8px 10px', background: '#0a0a12', border: '1px solid #1e1e2e',
                  borderRadius: 4, color: '#cbd5e1', fontSize: isMobile ? 16 : 13, boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleConfirmSet}
              disabled={!setDate || !setTime || setSending}
              style={{
                ...btn, ...mobBtn, flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
                background: setDate && setTime && !setSending ? '#22c55e' : '#222',
                color: setDate && setTime && !setSending ? '#fff' : '#555',
              }}
            >
              {setSending ? 'Sending...' : 'Confirm Set'}
            </button>
            <button onClick={() => setPhase('interested')} style={{ ...btn, ...mobBtn, background: '#23232a', color: '#94a3b8', padding: '10px 16px', fontSize: 12 }}>
              Back
            </button>
          </div>
        </div>
      )}

      {phase === 'set_sent' && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CheckCircle size={40} color="#22c55e" style={{ marginBottom: 8 }} />
          <div style={{ color: '#22c55e', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            Sent to Adil
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            Set booked and posted to Discord
          </div>
          <button onClick={() => advanceNext(lead!.lead_id)} style={{ ...btn, ...mobBtn, background: '#6366f1', color: '#fff', padding: '10px 24px', fontSize: 13, fontWeight: 600 }}>
            Next Lead
          </button>
        </div>
      )}

      {phase === 'schedule_fu' && (
        <div>
          <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Marked as Interested
          </div>
          <div style={{ color: '#eab308', fontSize: 11, marginBottom: 10 }}>
            Set a follow-up date — interested leads without callbacks fall through the cracks.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: isMobile ? 'stretch' : 'flex-end', flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>Follow-up date</label>
              <input
                type="date"
                value={fuDate}
                onChange={(e) => setFuDate(e.target.value)}
                style={{
                  width: '100%', padding: isMobile ? '12px 10px' : '8px 10px', background: '#0a0a12', border: '1px solid #1e1e2e',
                  borderRadius: 4, color: '#cbd5e1', fontSize: isMobile ? 16 : 13, boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSaveFollowUp}
                disabled={!fuDate}
                style={{ ...btn, ...mobBtn, flex: 1, background: fuDate ? '#eab308' : '#222', color: '#000', padding: '9px 18px', fontSize: 13, fontWeight: 600 }}
              >
                Save
              </button>
              <button onClick={handleSkipFollowUp} style={{ ...btn, ...mobBtn, flex: 1, background: '#23232a', color: '#94a3b8', padding: '9px 14px', fontSize: 12 }}>
                Skip (no follow-up)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back / Skip / Undo row — always visible in idle */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {lastBadNumberId && (
            <button
              onClick={handleUndoBadNumber}
              disabled={undoBadNumber.isPending}
              style={{ ...btn, flex: 0, background: '#261f11', color: '#eab308', padding: '8px 14px', fontSize: 11 }}
            >
              {undoBadNumber.isPending ? 'Undoing...' : 'Undo Bad #'}
            </button>
          )}
          <button
            onClick={() => { if (currentIndex > 0) { setCurrentIndex((i) => i - 1); setPhoneIndex(0); setShowDetail(false); setNote(''); setFuDate('') } }}
            disabled={currentIndex === 0}
            style={{ ...btn, ...mobBtn, flex: 1, background: isMobile ? '#1e1e25' : 'transparent', color: currentIndex === 0 ? '#1e1e2e' : (isMobile ? '#94a3b8' : '#334155'), padding: isMobile ? '12px 0' : '8px 0', fontSize: isMobile ? 14 : 11, border: isMobile ? '1px solid #27272e' : 'none', borderRadius: 8, cursor: currentIndex === 0 ? 'default' : 'pointer' }}
          >
            <ArrowLeft size={isMobile ? 16 : 12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Back Lead
          </button>
          <button
            onClick={() => { setLastBadNumberId(null); advanceNext() }}
            style={{ ...btn, ...mobBtn, flex: 1, background: isMobile ? '#1e1e25' : 'transparent', color: isMobile ? '#94a3b8' : '#334155', padding: isMobile ? '12px 0' : '8px 0', fontSize: isMobile ? 14 : 11, border: isMobile ? '1px solid #27272e' : 'none', borderRadius: 8 }}
          >
            Skip Lead <ArrowRight size={isMobile ? 16 : 12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
          </button>
        </div>
      )}

      {/* Auto-advance countdown */}
      {autoDialer.dialerMode === 'auto' && autoDialer.autoDialState === 'countdown' && (
        <AutoAdvanceCountdown
          secondsRemaining={autoDialer.countdownRemaining}
          totalSeconds={3}
          onSkip={autoDialer.skipCountdown}
          onPause={autoDialer.togglePause}
          nextLeadName={queue[currentIndex + 1]?.owner_name || null}
        />
      )}

      {/* Session cost tracker — auto mode only */}
      {autoDialer.dialerMode === 'auto' && (
        <SessionCostBar
          calls={autoDialer.sessionStats.calls}
          connected={autoDialer.sessionStats.connected}
          totalSeconds={autoDialer.sessionStats.totalSeconds}
          estimatedCost={autoDialer.sessionStats.estimatedCost}
        />
      )}

      {/* Callback section */}
      {!callbackOpen && !callbackLead && (
        <button
          onClick={() => { setCallbackOpen(true); setCallbackPhone(''); setCallbackError('') }}
          style={{
            ...btn, ...mobBtn, width: '100%', marginTop: 12,
            padding: isMobile ? '14px 0' : '10px 0',
            background: '#0f1a2e', border: '1px solid #1a2d4a', borderRadius: 10,
            color: '#60a5fa', fontSize: isMobile ? 14 : 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <PhoneIncoming size={isMobile ? 18 : 16} />
          Getting a Call Back
        </button>
      )}

      {callbackOpen && (
        <div style={{
          marginTop: 12, padding: isMobile ? 16 : 14,
          background: '#0f1a2e', border: '1px solid #1a2d4a', borderRadius: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <PhoneIncoming size={16} color="#60a5fa" />
            <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Incoming Callback</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="tel"
              value={callbackPhone}
              onChange={(e) => setCallbackPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCallbackLookup() }}
              placeholder="Enter caller's number"
              autoFocus
              style={{
                flex: 1, padding: isMobile ? '12px' : '9px 12px',
                background: '#0a0a12', border: '1px solid #1e1e2e', borderRadius: 6,
                color: '#e2e8f0', fontSize: isMobile ? 18 : 15, fontFamily: 'monospace',
              }}
            />
            <button
              onClick={handleCallbackLookup}
              disabled={callbackLoading}
              style={{
                ...btn, background: '#3b82f6', color: '#fff',
                padding: isMobile ? '12px 20px' : '9px 16px',
                fontSize: isMobile ? 15 : 13,
              }}
            >
              {callbackLoading ? '...' : 'Find'}
            </button>
            <button
              onClick={() => { setCallbackOpen(false); setCallbackError('') }}
              style={{ ...btn, background: '#1e1e2e', color: '#64748b', padding: '9px 12px' }}
            >
              <X size={16} />
            </button>
          </div>
          {callbackError && (
            <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{callbackError}</div>
          )}
        </div>
      )}

      {callbackLead && (
        <CallbackCard
          lead={callbackLead}
          isMobile={isMobile}
          onDismiss={() => { setCallbackLead(null); setCallbackPhone('') }}
          onDone={() => { setCallbackLead(null); setCallbackPhone('') }}
        />
      )}
    </Overlay>
  )
}

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
}

function Overlay({ children, onClose: _onClose, rightPanel }: { children: React.ReactNode; onClose: () => void; isMobile?: boolean; rightPanel?: React.ReactNode }) {
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#0a0a12',
        display: 'flex',
      }}
    >
      <div style={{
        width: rightPanel ? '440px' : '100%',
        flexShrink: 0,
        overflow: 'auto',
        padding: '16px 16px env(safe-area-inset-bottom, 16px)',
        boxSizing: 'border-box',
      }}>
        {children}
      </div>
      {rightPanel}
    </div>,
    document.body
  )
}

const DISP_LABELS: Record<string, { label: string; color: string }> = {
  answered: { label: 'Answered', color: '#22c55e' },
  no_answer: { label: 'No Answer', color: '#ef4444' },
  interested: { label: 'Interested', color: '#22c55e' },
  not_interested: { label: 'Not Interested', color: '#ef4444' },
  voicemail: { label: 'Voicemail', color: '#eab308' },
  bad_number: { label: 'Bad Number', color: '#ef4444' },
}

function CallHistory({ leadId }: { leadId: string }) {
  const { data: history } = useQuery({
    queryKey: ['call-history', leadId],
    queryFn: () => hermesClient.leads.callHistory(leadId),
  })

  if (!history || history.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>Call History</div>
      {history.map((c) => {
        const d = DISP_LABELS[c.disposition] || { label: c.disposition, color: '#94a3b8' }
        const dt = new Date(c.called_at)
        const time = dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 }}>
            <span style={{ color: d.color, fontWeight: 600, minWidth: 90 }}>{d.label}</span>
            {c.phone_number && <span style={{ color: '#64748b', fontSize: 11 }}>{formatPhone(c.phone_number)}</span>}
            <span style={{ color: '#475569' }}>{time}</span>
            {c.notes && <span style={{ color: '#64748b', fontSize: 11 }}>— {c.notes}</span>}
          </div>
        )
      })}
    </div>
  )
}

function DetailExpand({ lead, isMobile }: { lead: Lead; isMobile: boolean }) {
  return (
    <div style={{
      background: '#0a0a12', border: '1px solid #1a1a28', borderRadius: 14, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <Row label="Score" value={`${lead.motivation_score ?? '—'} (${lead.motivation_tier ?? '—'})`} />
        <Row label="Persona" value={lead.persona_primary || '—'} />
        <Row label="ARV" value={lead.arv_estimate ? `$${lead.arv_estimate.toLocaleString()}` : '—'} />
        <Row label="MAO" value={lead.mao ? `$${lead.mao.toLocaleString()}` : '—'} />
        <Row label="Router" value={lead.router_decision || '—'} />
        <Row label="Status" value={lead.status} />
        <Row label="Property" value={lead.property_type || '—'} />
        <Row label="Source" value={lead.source || '—'} />
      </div>

      {lead.distress_signals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Distress Signals</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {lead.distress_signals.map((sig) => (
              <span key={sig} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, background: '#271118', color: '#ef4444' }}>{sig}</span>
            ))}
          </div>
        </div>
      )}

      {lead.callable_phones.length > 1 && (
        <div>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>All Phones</div>
          {lead.callable_phones.map((p, i) => (
            isMobile ? (
              <a
                key={i}
                href={`tel:+${toTelDigits(p.phone_value)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                  background: '#12121c', textDecoration: 'none',
                }}
              >
                <Phone size={14} color="#22c55e" />
                <span style={{ color: '#cbd5e1', fontSize: 14 }}>{formatPhone(p.phone_value)}</span>
                <span style={{ color: '#475569', fontSize: 11 }}>({p.phone_type})</span>
                {p.dnc ? <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 4 }}>DNC</span> : null}
              </a>
            ) : (
              <div key={i} style={{ color: '#cbd5e1', fontSize: 13 }}>
                {formatPhone(p.phone_value)} <span style={{ color: '#475569' }}>({p.phone_type})</span>
                {p.dnc ? <span style={{ color: '#ef4444', marginLeft: 4 }}>DNC</span> : null}
              </div>
            )
          ))}
        </div>
      )}

      {lead.router_reason && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Router Reason</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>{lead.router_reason}</div>
        </div>
      )}

      <CallHistory leadId={lead.lead_id} />
      <LeadRecordings leadId={lead.lead_id} />
    </div>
  )
}

function LeadRecordings({ leadId }: { leadId: string }) {
  const { data: recordings } = useQuery({
    queryKey: ['lead-recordings', leadId],
    queryFn: () => hermesClient.callRecordings.byLead(leadId),
  })

  if (!recordings || recordings.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
        Call Recordings ({recordings.length})
      </div>
      {recordings.map((r) => {
        const dt = r.call_date ? new Date(r.call_date) : null
        const when = dt ? dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : ''
        return (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            padding: '8px 10px', background: '#0d0d14', border: '1px solid #1a1a28', borderRadius: 8,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{when}</span>
                {r.call_score
                  ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{r.call_score}</span>
                  : r.transcript
                    ? <span style={{ color: '#64748b', fontSize: 10 }}>awaiting grade</span>
                    : <span style={{ color: '#64748b', fontSize: 10 }}>transcribing…</span>}
              </div>
              {r.transcript && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.transcript.slice(0, 120)}
                </div>
              )}
            </div>
            {r.file_path && (
              <audio controls preload="none" src={hermesClient.callRecordings.audioUrl(r.id)} style={{ height: 32, maxWidth: 200 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#cbd5e1' }}>{value}</div>
    </div>
  )
}

type CbPhase = 'idle' | 'answered' | 'interested' | 'schedule_fu' | 'done'

function CallbackCard({ lead, isMobile, onDismiss, onDone }: {
  lead: Lead; isMobile: boolean; onDismiss: () => void; onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [cbPhase, setCbPhase] = useState<CbPhase>('idle')
  const [cbNote, setCbNote] = useState('')
  const [cbFuDate, setCbFuDate] = useState('')
  const [showCbDetail, setShowCbDetail] = useState(false)

  const tierColor = TIER_COLORS[lead.motivation_tier || ''] || '#666'

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue-all'] })
    queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    queryClient.invalidateQueries({ queryKey: ['kpi-summary'] })
  }, [queryClient])

  const updateStatus = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      hermesClient.leads.updateStatus(lead.lead_id, status, reason),
    onSuccess: () => invalidate(),
  })

  const addNote = useMutation({
    mutationFn: () => hermesClient.leads.addNote(lead.lead_id, 'call_note', cbNote),
    onSuccess: () => invalidate(),
  })

  const scheduleFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(lead.lead_id, 'callback', cbFuDate, cbNote || undefined),
    onSuccess: async () => {
      await updateStatus.mutateAsync({ status: 'follow_up', reason: `Follow-up scheduled ${cbFuDate}` })
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  function logCall(disposition: string, notes?: string) {
    hermesClient.leads.logCall(lead.lead_id, disposition, notes).catch(() => {})
  }

  async function handleNotInterested() {
    logCall('not_interested')
    await updateStatus.mutateAsync({ status: 'not_interested', reason: 'Not interested — callback' })
    setCbPhase('done')
  }

  async function handleSaveInterested() {
    if (cbNote.trim()) await addNote.mutateAsync()
    logCall('interested', cbNote.trim() || undefined)
    await updateStatus.mutateAsync({ status: 'interested', reason: 'Interested — callback' })
    setCbPhase('schedule_fu')
  }

  async function handleSaveFollowUp() {
    if (cbFuDate) await scheduleFollowUp.mutateAsync()
    setCbPhase('done')
  }

  const cbBtn: React.CSSProperties = {
    ...btn, fontSize: 12, padding: isMobile ? '10px 0' : '8px 0', fontWeight: 600,
  }

  return (
    <div style={{
      marginTop: 12, background: '#0d1a14', border: '1px solid #1a3d2a',
      borderRadius: 12, padding: isMobile ? 16 : 14,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhoneIncoming size={16} color="#22c55e" />
          <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>CALLBACK</span>
        </div>
        <button
          onClick={onDismiss}
          style={{ ...btn, background: '#1a2e1a', color: '#64748b', padding: '3px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          <X size={11} /> Dismiss
        </button>
      </div>

      {/* Lead info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#e2e8f0', fontSize: isMobile ? 16 : 15, fontWeight: 600, marginBottom: 2 }}>
            {lead.owner_name || 'Unknown Owner'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            {lead.address_full || lead.address_street || '—'}
          </div>
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
          color: tierColor, background: '#1a1520', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {lead.motivation_tier} {lead.motivation_score ?? ''}
        </span>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: 14, fontSize: 11, flexWrap: 'wrap', marginBottom: 8 }}>
        {lead.mao && (
          <div><span style={{ color: '#475569' }}>MAO </span><span style={{ color: '#22c55e' }}>${lead.mao.toLocaleString()}</span></div>
        )}
        {lead.arv_estimate && (
          <div><span style={{ color: '#475569' }}>ARV </span><span style={{ color: '#cbd5e1' }}>${lead.arv_estimate.toLocaleString()}</span></div>
        )}
        {lead.persona_primary && (
          <div><span style={{ color: '#475569' }}>Persona </span><span style={{ color: '#cbd5e1' }}>{lead.persona_primary}</span></div>
        )}
      </div>

      {/* Distress signals */}
      {lead.distress_signals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {lead.distress_signals.map((sig) => (
            <span key={sig} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, background: '#271118', color: '#ef4444' }}>{sig}</span>
          ))}
        </div>
      )}

      {/* View Details toggle */}
      <button
        onClick={() => setShowCbDetail(!showCbDetail)}
        style={{ ...btn, background: '#0d2618', color: '#6ee7b7', width: '100%', marginBottom: 8, padding: '6px 0', fontSize: 11, border: '1px solid #1a3d2a', borderRadius: 6 }}
      >
        {showCbDetail ? 'Hide Details' : 'View Details'}
      </button>

      {showCbDetail && <DetailExpand lead={lead} isMobile={isMobile} />}

      {/* Action buttons — phase-dependent */}
      {cbPhase === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { logCall('answered'); setCbPhase('answered') }}
            style={{ ...cbBtn, flex: 1, background: '#22c55e', color: '#fff' }}>
            Answered
          </button>
          <button onClick={() => { logCall('no_answer'); onDismiss() }}
            style={{ ...cbBtn, flex: 1, background: '#ef4444', color: '#fff' }}>
            No Answer
          </button>
        </div>
      )}

      {cbPhase === 'answered' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCbPhase('interested')}
            style={{ ...cbBtn, flex: 1, background: '#0d211c', color: '#22c55e' }}>
            Interested
          </button>
          <button onClick={handleNotInterested}
            style={{ ...cbBtn, flex: 1, background: '#271118', color: '#ef4444' }}>
            Not Interested
          </button>
          <button onClick={() => setCbPhase('idle')}
            style={{ ...cbBtn, background: '#1a2e1a', color: '#94a3b8', padding: '8px 12px' }}>
            Back
          </button>
        </div>
      )}

      {cbPhase === 'interested' && (
        <div>
          <textarea
            value={cbNote}
            onChange={(e) => setCbNote(e.target.value)}
            placeholder="Notes from the callback..."
            rows={2}
            style={{
              width: '100%', padding: '8px 10px', background: '#0a0a12', border: '1px solid #1a3d2a',
              borderRadius: 6, color: '#cbd5e1', fontSize: isMobile ? 15 : 13, resize: 'vertical', marginBottom: 8, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSaveInterested}
              style={{ ...cbBtn, flex: 1, background: '#22c55e', color: '#fff' }}>
              Save & Schedule Follow-Up
            </button>
            <button onClick={() => setCbPhase('answered')}
              style={{ ...cbBtn, background: '#1a2e1a', color: '#94a3b8', padding: '8px 12px' }}>
              Back
            </button>
          </div>
        </div>
      )}

      {cbPhase === 'schedule_fu' && (
        <div>
          <div style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Marked as Interested</div>
          <div style={{ display: 'flex', gap: 8, alignItems: isMobile ? 'stretch' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#475569', display: 'block', marginBottom: 3 }}>Follow-up date</label>
              <input
                type="date"
                value={cbFuDate}
                onChange={(e) => setCbFuDate(e.target.value)}
                style={{
                  width: '100%', padding: isMobile ? '10px' : '7px 10px', background: '#0a0a12', border: '1px solid #1a3d2a',
                  borderRadius: 4, color: '#cbd5e1', fontSize: isMobile ? 15 : 13, boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSaveFollowUp} disabled={!cbFuDate}
                style={{ ...cbBtn, flex: 1, background: cbFuDate ? '#eab308' : '#222', color: '#000', padding: '8px 16px' }}>
                Save
              </button>
              <button onClick={() => { setCbPhase('done') }}
                style={{ ...cbBtn, flex: 1, background: '#1a2e1a', color: '#94a3b8', padding: '8px 12px' }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {cbPhase === 'done' && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Done</div>
          <button onClick={onDone} style={{ ...cbBtn, background: '#1a2e1a', color: '#6ee7b7', padding: '8px 20px' }}>
            Close Callback
          </button>
        </div>
      )}
    </div>
  )
}

function ScriptPanel({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      borderLeft: '1px solid #1e1e2e',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 16px', borderBottom: '1px solid #1e1e2e', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={15} color="#6366f1" />
          <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Cold Calling Script</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', padding: 4 }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        <ColdCallScript />
      </div>
    </div>
  )
}

function ScriptSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#6366f1',
        textTransform: 'uppercase', letterSpacing: 0.8,
        marginBottom: 10, paddingBottom: 6,
        borderBottom: '1px solid #1e1e2e',
      }}>{title}</div>
      {children}
    </div>
  )
}

function SayLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      borderLeft: '3px solid #22c55e', padding: '8px 12px', margin: '6px 0',
      background: '#0d1a14', borderRadius: '0 6px 6px 0',
      color: '#e2e8f0', fontSize: 13, lineHeight: 1.5,
    }}>
      {children}
    </div>
  )
}

function ToneNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic', padding: '2px 0 2px 15px', lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

function SellerLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic', padding: '4px 0 4px 15px' }}>
      <span style={{ color: '#475569' }}>SELLER:</span> {children}
    </div>
  )
}

function RuleCallout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '6px 10px', margin: '6px 0',
      background: '#1f0f0f', border: '1px solid #3a1a1a',
      borderRadius: 6, color: '#ef4444', fontSize: 11, lineHeight: 1.5,
    }}>
      <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  )
}

function ColdCallScript() {
  return (
    <>
      <div style={{
        padding: '10px 14px', marginBottom: 20,
        background: '#12121c', border: '1px solid #1e1e2e', borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          3 Non-Negotiable Rules
        </div>
        <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.8 }}>
          <div>1. <strong>Never</strong> negotiate numbers, repair costs, or offer amounts.</div>
          <div>2. <strong>Never</strong> book more than 3 days out.</div>
          <div>3. Get <strong>2–3 confirmations</strong> before calling it booked.</div>
        </div>
      </div>

      <ScriptSection title="Opening">
        <SayLine>"Hi, is this <strong>[Seller Name]</strong>?"</SayLine>
        <ToneNote>Curious, casual tone — like you already half-know them</ToneNote>
        <SellerLine>"Yeah, who's this?"</SellerLine>
        <SayLine>"Yeah, I was calling about your property on <strong>[address]</strong>."</SayLine>
        <ToneNote>Trail off here, let it hang — don't explain yourself yet</ToneNote>
        <RuleCallout>Do NOT open with "the reason for my call is..." — it sounds scripted.</RuleCallout>
      </ScriptSection>

      <ScriptSection title="Qualifying">
        <SayLine>"Have you thought about selling it any time in the near future?"</SayLine>
        <SellerLine>"Yeah, we've been thinking about it."</SellerLine>
        <SayLine>"Got it — how long has this been going on?"</SayLine>
        <ToneNote>10–20 seconds, surface level only. Grab one basic reason + rough timeline — nothing deeper. This is not the time to dig into pain or negotiate.</ToneNote>
      </ScriptSection>

      <ScriptSection title="If They Ask Why You're Calling">
        <SayLine>"We actually buy properties in the area and yours looked like a good fit — I just wanted to ask a couple quick questions about the property. Does that sound fair?"</SayLine>
      </ScriptSection>

      <ScriptSection title="Bridge to Booking">
        <SayLine>"What I'd like to do is set up a quick appointment with my partner — he buys properties in this area, and he'll be the one to go over the details on the property's condition with you so we can get you an accurate cash offer."</SayLine>
        <SayLine>"Would you be completely opposed to him giving you a call tomorrow at <strong>[time]</strong>, or would that work for you?"</SayLine>
        <ToneNote>If tomorrow doesn't work, offer the next 1–2 days — never further than 3 days out.</ToneNote>
      </ScriptSection>

      <ScriptSection title="Locking the Appointment">
        <SayLine>"Great — so tomorrow at 3pm works for you?"</SayLine>
        <SellerLine>"Yeah, that works."</SellerLine>
        <SayLine>"Perfect, he'll give you a call at 3pm. You two can go over the details and possibly work out a cash offer on the home."</SayLine>
        <SayLine>"So just to confirm — tomorrow at 3pm, he'll be calling you. Sound good?"</SayLine>
        <RuleCallout>That's 2 confirmations minimum. If either answer felt hesitant, ask a third time before hanging up.</RuleCallout>
      </ScriptSection>

      <ScriptSection title="Closing the Call">
        <SayLine>"Awesome, thank you for your time. Just so he reaches you at the right number — is this the best number to call you at tomorrow at 3pm?"</SayLine>
        <SellerLine>"Yeah, this number's good." / "Actually, call my cell instead — [number]."</SellerLine>
        <SayLine>"Perfect, he'll call you at 3pm tomorrow. Thanks again, <strong>[Seller Name]</strong>."</SayLine>
        <ToneNote>Confirm or update the phone number, then log immediately in Slack.</ToneNote>
      </ScriptSection>

      <ScriptSection title="Common Objections">
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eab308', marginBottom: 4 }}>"How much are you offering?"</div>
          <SayLine>"That's exactly what my partner will go over with you on the call — he'll walk you through some numbers based on the property."</SayLine>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eab308', marginBottom: 4 }}>"I'm not really interested."</div>
          <SayLine>"No worries at all — mind if I ask, is that a hard no, or more like not right now?"</SayLine>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eab308', marginBottom: 4 }}>"Who are you? Is this a scam?"</div>
          <SayLine>"Totally fair question — we're a local group of investors that buy homes directly from homeowners in the area, no realtors or fees involved."</SayLine>
        </div>
      </ScriptSection>

      <ScriptSection title="After Every Call — Logging">
        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.8 }}>
          <div>• <strong>Booked appointment</strong> → log in Slack with name, address, date/time, phone</div>
          <div>• <strong>Callback requested</strong> → log date/time to call back</div>
          <div>• <strong>Not interested / hard no</strong> → log as dead lead</div>
          <div>• <strong>No answer</strong> → log as attempted, will be redialed</div>
        </div>
        <RuleCallout>Never leave a call unlogged. Unlogged calls = leads that get lost.</RuleCallout>
      </ScriptSection>
    </>
  )
}
