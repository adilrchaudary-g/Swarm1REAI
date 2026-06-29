import { useState, useMemo, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, X, ArrowRight, PhoneCall } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
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

type Phase = 'idle' | 'answered' | 'no_answer' | 'interested' | 'schedule_fu'

interface Props {
  leads: Lead[]
  onClose: () => void
}

export function DialMode({ leads, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [showDetail, setShowDetail] = useState(false)
  const [note, setNote] = useState('')
  const [fuDate, setFuDate] = useState('')
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [voicemailIds, setVoicemailIds] = useState<string[]>([])
  const [lastBadNumberId, setLastBadNumberId] = useState<string | null>(null)
  const [phoneIndex, setPhoneIndex] = useState(0)

  const queue = useMemo(() => {
    const main = leads.filter((l) => !skippedIds.has(l.lead_id) && !voicemailIds.includes(l.lead_id))
    const vm = voicemailIds
      .filter((id) => !skippedIds.has(id))
      .map((id) => leads.find((l) => l.lead_id === id))
      .filter(Boolean) as Lead[]
    return [...main, ...vm]
  }, [leads, skippedIds, voicemailIds])

  const lead = queue[currentIndex] ?? null
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
    setPhoneIndex(0)
    if (hasNext) {
      setCurrentIndex((i) => i + 1)
    } else {
      setCurrentIndex(0)
    }
  }

  function logCall(disposition: string, notes?: string) {
    if (lead) hermesClient.leads.logCall(lead.lead_id, disposition, notes, rawPhone || undefined).catch(() => {})
  }

  function handleAnswered() { setLastBadNumberId(null); logCall('answered'); setPhase('answered') }

  function handleNoAnswer() {
    setLastBadNumberId(null)
    logCall('no_answer')
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

  const mobBtn: React.CSSProperties = isMobile
    ? { minHeight: 48, fontSize: 15 }
    : {}

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
    <Overlay onClose={onClose} isMobile={isMobile}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: '#6366f1', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>DIAL TIME</div>
          <span style={{ color: '#334155', fontSize: 12 }}>{currentIndex + 1} / {total}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', padding: 8 }}><X size={20} /></button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#16162a', borderRadius: 2, marginBottom: 20 }}>
        <div style={{ height: '100%', background: '#6366f1', borderRadius: 2, width: `${((currentIndex + 1) / total) * 100}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Lead card */}
      <div style={{ background: '#0d0d14', border: '1px solid #1e1e2e', borderRadius: 10, padding: isMobile ? 16 : 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: isMobile ? 16 : 18, fontWeight: 600, marginBottom: 4 }}>
              <span>{lead.owner_name || 'Unknown Owner'}</span>
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

        {/* Phone number — tappable on mobile */}
        {telHref ? (
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
            <button onClick={handleSaveInterested} style={{ ...btn, ...mobBtn, flex: 1, background: '#22c55e', color: '#fff', padding: '10px 0', fontSize: 13, fontWeight: 600 }}>
              Save & Schedule Follow-Up
            </button>
            <button onClick={() => setPhase('answered')} style={{ ...btn, ...mobBtn, background: '#23232a', color: '#94a3b8', padding: '10px 16px', fontSize: 12 }}>
              Back
            </button>
          </div>
        </div>
      )}

      {phase === 'schedule_fu' && (
        <div>
          <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Marked as Interested
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
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip / Undo row — always visible in idle */}
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
            onClick={() => { setLastBadNumberId(null); advanceNext() }}
            style={{ ...btn, ...mobBtn, flex: 1, background: isMobile ? '#1e1e25' : 'transparent', color: isMobile ? '#94a3b8' : '#334155', padding: isMobile ? '12px 0' : '8px 0', fontSize: isMobile ? 14 : 11, border: isMobile ? '1px solid #27272e' : 'none', borderRadius: 8 }}
          >
            Skip Lead <ArrowRight size={isMobile ? 16 : 12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
          </button>
        </div>
      )}
    </Overlay>
  )
}

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void; isMobile?: boolean }) {
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#0a0a12',
        overflow: 'auto',
        padding: '16px 16px env(safe-area-inset-bottom, 16px)',
        boxSizing: 'border-box',
      }}
    >
      {children}
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
