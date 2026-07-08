import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, FileSignature } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import { useLeadStore } from '../../../store/lead-store'
import { DialMode } from './DialMode'
import { ContractWizard } from '../../contracts/ContractWizard'
import type { Lead } from '../../../api/types'

const TIER_COLORS: Record<string, string> = {
  HOT: '#ef4444', WARM: '#f97316', LUKEWARM: '#eab308', COLD: '#3b82f6', ICE: '#94a3b8',
  hot: '#ef4444', warm: '#f97316', lukewarm: '#eab308', cold: '#3b82f6', ice: '#94a3b8',
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'enriched', label: 'Enriched' },
  { value: 'queued', label: 'Queued' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'follow_up', label: 'Follow-Up' },
]

const DISPOSITIONS = [
  { status: 'contacted', label: 'No Answer', color: '#94a3b8' },
  { status: 'interested', label: 'Interested', color: '#22c55e' },
  { status: 'not_interested', label: 'Not Interested', color: '#ef4444' },
  { status: 'follow_up', label: 'Follow Up', color: '#eab308' },
] as const

const btnBase = {
  border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600 as const,
  cursor: 'pointer', padding: '5px 10px',
}

function LeadRow({
  lead,
  index,
  isActive,
  isSelected,
  onToggleSelect,
}: {
  lead: Lead
  index: number
  isActive: boolean
  isSelected: boolean
  onToggleSelect: (leadId: string) => void
}) {
  const setActiveLead = useLeadStore((s) => s.setActiveLead)
  const tier = lead.motivation_tier || ''
  const tierColor = TIER_COLORS[tier] || '#666'

  return (
    <tr
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: isActive ? 'rgba(99,102,241,0.12)' : isSelected ? '#16163a' : 'transparent',
      }}
    >
      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(lead.lead_id)}
          style={{ cursor: 'pointer', accentColor: '#6366f1' }}
        />
      </td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 13 }}>{index + 1}</td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#e2e8f0', fontSize: 13 }}>
        {lead.address_street || lead.address_full || '—'}
        <div style={{ fontSize: 11, color: '#64748b' }}>
          {[lead.address_city, lead.address_state, lead.address_zip].filter(Boolean).join(', ')}
        </div>
      </td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#bbb', fontSize: 13 }}>{lead.owner_name || '—'}</td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px' }}>
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 600, color: tierColor, background: tierColor + '20',
        }}>
          {tier} {lead.motivation_score ?? ''}
        </span>
      </td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>{lead.persona_primary || '—'}</td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>
        {lead.arv_estimate ? `$${lead.arv_estimate.toLocaleString()}` : '—'}
      </td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>
        {lead.callable_phones.length > 0
          ? lead.callable_phones[0].phone_value
          : <span style={{ color: '#ef4444', fontSize: 11 }}>no phone</span>}
      </td>
      <td onClick={() => setActiveLead(lead)} style={{ padding: '10px 12px', color: '#475569', fontSize: 11 }}>{lead.source || '—'}</td>
    </tr>
  )
}

function DetailPanel({ lead }: { lead: Lead }) {
  const queryClient = useQueryClient()
  const setActiveLead = useLeadStore((s) => s.setActiveLead)
  const [note, setNote] = useState('')
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [fuDate, setFuDate] = useState('')
  const [showContractWizard, setShowContractWizard] = useState(false)

  const updateStatus = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      hermesClient.leads.updateStatus(lead.lead_id, status, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
  })

  const addNote = useMutation({
    mutationFn: () => hermesClient.leads.addNote(lead.lead_id, 'call_note', note),
    onSuccess: () => {
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['lead', lead.lead_id] })
    },
  })

  const scheduleFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(lead.lead_id, 'callback', fuDate, note || undefined),
    onSuccess: () => {
      setShowFollowUp(false)
      setFuDate('')
      setNote('')
      updateStatus.mutate({ status: 'follow_up', reason: `Follow-up scheduled for ${fuDate}` })
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  const inputStyle = {
    width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#cbd5e1', fontSize: 12,
  }

  const canQueue = lead.status === 'new' || lead.status === 'enriched' || lead.status === 'scored'
  const canArchive = lead.status !== 'archived' && lead.status !== 'dead'
  const canRemoveFromQueue = lead.status === 'queued'

  return (
    <div style={{
      width: 380, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14, padding: 20, position: 'sticky', top: 24,
      maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: 0 }}>Lead Detail</h3>
        <button
          onClick={() => setActiveLead(null)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}
        ><X size={16} /></button>
      </div>

      <p style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 14, margin: '0 0 2px' }}>{lead.address_full}</p>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 4px' }}>{lead.owner_name}</p>
      <p style={{ fontSize: 11, color: '#475569', margin: '0 0 16px' }}>Status: <span style={{ color: '#6366f1' }}>{lead.status}</span></p>

      {/* Status transition buttons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>Actions</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canQueue && (
            <button
              onClick={() => updateStatus.mutate({ status: 'queued', reason: 'Moved to queue from detail panel' })}
              disabled={updateStatus.isPending}
              style={{ ...btnBase, color: '#22c55e', background: '#22c55e18', opacity: updateStatus.isPending ? 0.5 : 1 }}
            >{updateStatus.isPending ? 'Moving...' : 'Move to Queue'}</button>
          )}
          {canRemoveFromQueue && (
            <button
              onClick={() => updateStatus.mutate({ status: 'new', reason: 'Removed from queue' })}
              disabled={updateStatus.isPending}
              style={{ ...btnBase, color: '#f97316', background: '#f9731618', opacity: updateStatus.isPending ? 0.5 : 1 }}
            >{updateStatus.isPending ? 'Removing...' : 'Remove from Queue'}</button>
          )}
          {canArchive && (
            <button
              onClick={() => updateStatus.mutate({ status: 'archived', reason: 'Archived from detail panel' })}
              disabled={updateStatus.isPending}
              style={{ ...btnBase, color: '#ef4444', background: '#ef444418', opacity: updateStatus.isPending ? 0.5 : 1 }}
            >{updateStatus.isPending ? 'Archiving...' : 'Archive'}</button>
          )}
          <button
            onClick={() => setShowContractWizard(true)}
            style={{ ...btnBase, color: '#a78bfa', background: '#a78bfa18', display: 'flex', alignItems: 'center', gap: 4 }}
          ><FileSignature size={12} /> Generate Contract</button>
        </div>
      </div>

      {showContractWizard && (
        <ContractWizard lead={lead} onClose={() => setShowContractWizard(false)} />
      )}

      {(updateStatus.isError || addNote.isError || scheduleFollowUp.isError) && (
        <div style={{ padding: '6px 10px', borderRadius: 4, marginBottom: 8, background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 11 }}>
          {updateStatus.isError && `Update failed: ${updateStatus.error instanceof Error ? updateStatus.error.message : String(updateStatus.error)}`}
          {addNote.isError && `Note failed: ${addNote.error instanceof Error ? addNote.error.message : String(addNote.error)}`}
          {scheduleFollowUp.isError && `Follow-up failed: ${scheduleFollowUp.error instanceof Error ? scheduleFollowUp.error.message : String(scheduleFollowUp.error)}`}
        </div>
      )}

      {/* Call disposition buttons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>Call Result</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DISPOSITIONS.map((d) => (
            <button
              key={d.status}
              onClick={() => updateStatus.mutate({ status: d.status })}
              disabled={updateStatus.isPending}
              style={{ ...btnBase, color: d.color, background: d.color + '18', opacity: updateStatus.isPending ? 0.5 : 1 }}
            >
              {updateStatus.isPending ? '...' : d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick note */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Quick note..."
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) addNote.mutate() }}
          />
          <button
            onClick={() => addNote.mutate()}
            disabled={!note.trim() || addNote.isPending}
            style={{ ...btnBase, background: note.trim() ? '#6366f1' : '#222', color: '#fff', padding: '5px 12px' }}
          >+</button>
        </div>
      </div>

      {/* Schedule follow-up */}
      {!showFollowUp ? (
        <button
          onClick={() => setShowFollowUp(true)}
          style={{ ...btnBase, background: '#eab30818', color: '#eab308', marginBottom: 16, width: '100%', padding: '7px 0' }}
        >
          Schedule Follow-Up
        </button>
      ) : (
        <div style={{ marginBottom: 16, padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
          <input
            type="date"
            value={fuDate}
            onChange={(e) => setFuDate(e.target.value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => scheduleFollowUp.mutate()}
              disabled={!fuDate || scheduleFollowUp.isPending}
              style={{ ...btnBase, background: fuDate ? '#eab308' : '#222', color: '#000', flex: 1, padding: '6px 0' }}
            >Save</button>
            <button
              onClick={() => setShowFollowUp(false)}
              style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Details grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <Detail label="Score" value={`${lead.motivation_score ?? '—'} (${lead.motivation_tier ?? '—'})`} />
        <Detail label="Persona" value={lead.persona_primary || '—'} />
        <Detail label="ARV" value={lead.arv_estimate ? `$${lead.arv_estimate.toLocaleString()}` : '—'} />
        <Detail label="MAO" value={lead.mao ? `$${lead.mao.toLocaleString()}` : '—'} />
        <Detail label="Router" value={lead.router_decision || '—'} />
        <Detail label="Status" value={lead.status} />
      </div>

      {/* Distress signals */}
      {lead.distress_signals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Distress Signals</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {lead.distress_signals.map((sig) => (
              <span key={sig} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, background: '#ef444420', color: '#ef4444' }}>{sig}</span>
            ))}
          </div>
        </div>
      )}

      {/* Contact */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
        {lead.callable_phones.length > 0 ? (
          lead.callable_phones.map((p, i) => (
            <div key={i} style={{ color: '#cbd5e1', fontSize: 13 }}>
              {p.phone_value} <span style={{ color: '#475569' }}>({p.phone_type})</span>
              {p.dnc ? <span style={{ color: '#ef4444', marginLeft: 4 }}>DNC</span> : null}
            </div>
          ))
        ) : (
          <div style={{ color: '#ef4444', fontSize: 12 }}>Needs skip trace</div>
        )}
      </div>

      {/* Source + Router */}
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Source</div>
      <div style={{ color: '#aaa', fontSize: 12, marginBottom: 12 }}>{lead.source || '—'}</div>

      {lead.router_reason && (
        <>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Router Reason</div>
          <div style={{ color: '#777', fontSize: 11 }}>{lead.router_reason}</div>
        </>
      )}
    </div>
  )
}

// statusPulse keyframe is in index.css

export function CallList() {
  const [statusFilter, setStatusFilter] = useState('')
  const [dialMode, setDialMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [pipelineOpen, setPipelineOpen] = useState(false)
  const queryClient = useQueryClient()
  const logEndRef = useRef<HTMLDivElement>(null)

  const { data: leads, isLoading, error } = useQuery({
    queryKey: ['queue-all', statusFilter],
    queryFn: () => hermesClient.leads.list({
      status: statusFilter || undefined,
      exclude_statuses: statusFilter ? undefined : 'not_interested,archived,dead',
      limit: 500,
    }),
    refetchInterval: 15_000,
  })

  const activeLead = useLeadStore((s) => s.activeLead)

  const bulkUpdate = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      hermesClient.leads.bulkUpdateStatus(Array.from(selectedIds), status, reason),
    onSuccess: (data) => {
      setSelectedIds(new Set())
      setBulkResult(`Updated ${data.updated} leads`)
      setTimeout(() => setBulkResult(null), 3000)
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
    onError: (err) => {
      setBulkResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setBulkResult(null), 5000)
    },
  })

  const [pipelineLocalLog, _setPipelineLocalLog] = useState<string[]>([])
  const [pipelineError, _setPipelineError] = useState<string | null>(null)

  const { data: pipelineStatus } = useQuery({
    queryKey: ['skip-trace-pipeline-status'],
    queryFn: () => hermesClient.skipTrace.pipelineStatus(),
    refetchInterval: 3000,
  })

  const pipelineRunning = pipelineStatus?.running || false
  const leadsProcessing = (pipelineStatus as any)?.leads_processing ?? 0

  useEffect(() => {
    if (pipelineStatus && !pipelineStatus.running && pipelineStatus.phase === 'complete') {
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    }
  }, [pipelineStatus?.running, pipelineStatus?.phase, queryClient])

  useEffect(() => {
    if (pipelineRunning && !pipelineOpen) setPipelineOpen(true)
  }, [pipelineRunning, pipelineOpen])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pipelineStatus?.log_lines?.length])

  const readyLeads = useMemo(() => {
    if (!leads) return []
    return leads.filter((l) => l.callable_phones.length > 0 || (l.phone_numbers && l.phone_numbers.length > 0))
  }, [leads])

  const sourceGroups = useMemo(() => {
    if (!readyLeads.length) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const l of readyLeads) {
      const src = l.source || 'other'
      counts.set(src, (counts.get(src) || 0) + 1)
    }
    return counts
  }, [readyLeads])

  function formatGroupLabel(raw: string): string {
    return raw.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  const [sourceFilter, setSourceFilter] = useState('')

  const filtered = useMemo(() => {
    if (!readyLeads.length) return []
    let result = readyLeads
    if (sourceFilter) {
      result = result.filter((l) => (l.source || 'other') === sourceFilter)
    }
    return result
  }, [readyLeads, sourceFilter])

  const toggleSelect = useCallback((leadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((l) => l.lead_id)))
  }, [filtered])

  const selectNone = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Count how many selected leads are in each status for smart button display
  const selectedLeads = useMemo(() => {
    if (!leads || selectedIds.size === 0) return []
    return leads.filter((l) => selectedIds.has(l.lead_id))
  }, [leads, selectedIds])

  const selectedStatuses = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of selectedLeads) {
      counts[l.status] = (counts[l.status] || 0) + 1
    }
    return counts
  }, [selectedLeads])

  const hasQueueable = (selectedStatuses['new'] || 0) + (selectedStatuses['enriched'] || 0) + (selectedStatuses['scored'] || 0) > 0
  const hasQueuedSelected = (selectedStatuses['queued'] || 0) > 0
  const hasArchivable = selectedLeads.some((l) => l.status !== 'archived' && l.status !== 'dead')

  if (isLoading) return <div style={{ color: '#64748b' }}>Loading call list...</div>

  if (error) {
    return (
      <div>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Call List</h2>
        <div style={{ padding: 24, background: 'rgba(99,102,241,0.12)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
          <p>Connect to Hermes to load the call list.</p>
          <p style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            Run: <code style={{ color: '#6366f1' }}>python3 -m hermes serve</code>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header with count + DIAL TIME + Refresh */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: 0 }}>
            Call List
            <span style={{ color: '#64748b', fontSize: 14, marginLeft: 8 }}>
              ({filtered.length}{sourceFilter || statusFilter ? ` of ${leads?.length ?? 0}` : ''})
            </span>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setDialMode(true)}
              disabled={filtered.length === 0}
              style={{
                ...btnBase, padding: '7px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                background: filtered.length > 0 ? '#22c55e' : '#222',
                color: filtered.length > 0 ? '#fff' : '#555',
                borderRadius: 6,
              }}
            >DIAL TIME</button>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['queue-all'] })}
              style={{ ...btnBase, background: 'rgba(99,102,241,0.12)', color: '#94a3b8', padding: '6px 12px' }}
            >Refresh</button>
          </div>
        </div>

        {/* Source filter tabs */}
        {sourceGroups.size > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              onClick={() => setSourceFilter('')}
              style={{
                ...btnBase, fontSize: 11,
                background: !sourceFilter ? '#6366f120' : 'rgba(255,255,255,0.03)',
                color: !sourceFilter ? '#6366f1' : '#666',
                border: `1px solid ${!sourceFilter ? '#6366f140' : 'rgba(255,255,255,0.06)'}`,
              }}
            >All ({readyLeads.length})</button>
            {Array.from(sourceGroups.entries()).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                style={{
                  ...btnBase, fontSize: 11,
                  background: sourceFilter === src ? '#6366f120' : 'rgba(255,255,255,0.03)',
                  color: sourceFilter === src ? '#6366f1' : '#666',
                  border: `1px solid ${sourceFilter === src ? '#6366f140' : 'rgba(255,255,255,0.06)'}`,
                }}
              >{formatGroupLabel(src)} <span style={{ color: '#334155', marginLeft: 2 }}>({count})</span></button>
            ))}
          </div>
        )}

        {/* Status filter bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setSelectedIds(new Set()) }}
              style={{
                ...btnBase,
                background: statusFilter === f.value ? '#6366f120' : 'rgba(255,255,255,0.03)',
                color: statusFilter === f.value ? '#6366f1' : '#666',
                border: `1px solid ${statusFilter === f.value ? '#6366f140' : 'rgba(255,255,255,0.06)'}`,
              }}
            >{f.label}</button>
          ))}
        </div>

        {/* Processing banner — auto-shows when leads are being skip-traced */}
        {(leadsProcessing > 0 || pipelineRunning || pipelineOpen) && (
          <div style={{
            marginBottom: 12, padding: '10px 14px',
            background: pipelineRunning ? '#6366f110' : '#f9731610',
            border: `1px solid ${pipelineRunning ? '#6366f130' : '#f9731630'}`,
            borderRadius: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {pipelineRunning && (
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: '#6366f1',
                    animation: 'statusPulse 1.5s ease-in-out infinite',
                  }} />
                )}
                <div>
                  <span style={{ color: pipelineRunning ? '#6366f1' : '#f97316', fontSize: 13, fontWeight: 600 }}>
                    {pipelineRunning
                      ? `Enriching ${leadsProcessing > 0 ? leadsProcessing.toLocaleString() : ''} leads...`
                      : `${leadsProcessing.toLocaleString()} lead${leadsProcessing !== 1 ? 's' : ''} processing`}
                  </span>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                    {pipelineRunning
                      ? 'Skip trace pipeline is running — leads will appear here once enriched with phone numbers.'
                      : 'Leads without phone numbers are being queued for skip tracing automatically.'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPipelineOpen((o) => !o)}
                style={{
                  ...btnBase, padding: '7px 18px', fontSize: 12, fontWeight: 700,
                  color: '#6366f1', background: '#6366f118', borderRadius: 6,
                }}
              >
                {pipelineOpen ? 'Hide Log' : 'Show Log'}
              </button>
            </div>

            {pipelineOpen && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: pipelineRunning ? '#22c55e' : (pipelineStatus?.error || pipelineError) ? '#ef4444' : '#22c55e',
                      animation: pipelineRunning ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
                    }} />
                    <span style={{ color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {pipelineStatus?.phase === 'launching' && 'Launching...'}
                      {pipelineStatus?.phase === 'running' && `Running — ${pipelineStatus.address_count} addresses`}
                      {pipelineStatus?.phase === 'ingesting' && 'Ingesting results...'}
                      {pipelineStatus?.phase === 'complete' && 'Complete'}
                      {pipelineStatus?.phase === 'error' && 'Failed'}
                      {pipelineStatus?.phase === 'idle' && 'Idle'}
                      {!pipelineStatus && 'Connecting...'}
                    </span>
                  </div>
                  {!pipelineRunning && (
                    <button
                      onClick={() => setPipelineOpen(false)}
                      style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14 }}
                    ><X size={16} /></button>
                  )}
                </div>
                <div className={`log-tablet${pipelineRunning ? ' active' : pipelineError ? ' error' : pipelineStatus?.phase === 'complete' ? ' complete' : ''}`}>
                  {(pipelineStatus?.log_lines?.length ? pipelineStatus.log_lines : pipelineLocalLog).map((line, i) => (
                    <div key={i} style={{
                      color: line.includes('ERROR') ? '#ef4444'
                        : line.includes('[pipeline]') ? '#6366f1'
                          : line.includes('BALANCE') ? '#eab308'
                            : '#888',
                    }}>{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
                {(pipelineStatus?.error || pipelineError) && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: '#ef444418', borderRadius: 4, color: '#ef4444', fontSize: 11 }}>
                    {pipelineStatus?.error || pipelineError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bulk action bar -- appears when leads are selected */}
        {selectedIds.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
            padding: '8px 12px', background: 'rgba(99,102,241,0.12)', borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 600, marginRight: 4 }}>
              {selectedIds.size} selected
            </span>
            <span style={{ color: '#333', fontSize: 16, userSelect: 'none' }}>|</span>

            {hasQueueable && (
              <button
                onClick={() => bulkUpdate.mutate({ status: 'queued', reason: 'Bulk moved to queue' })}
                disabled={bulkUpdate.isPending}
                style={{ ...btnBase, color: '#22c55e', background: bulkUpdate.isPending ? '#22c55e30' : '#22c55e18', padding: '6px 14px' }}
              >{bulkUpdate.isPending ? 'Moving...' : 'Move to Queue'}</button>
            )}

            {hasQueuedSelected && (
              <button
                onClick={() => bulkUpdate.mutate({ status: 'new', reason: 'Bulk removed from queue' })}
                disabled={bulkUpdate.isPending}
                style={{ ...btnBase, color: '#f97316', background: bulkUpdate.isPending ? '#f9731630' : '#f9731618', padding: '6px 14px' }}
              >{bulkUpdate.isPending ? 'Removing...' : 'Remove from Queue'}</button>
            )}

            {hasArchivable && (
              <button
                onClick={() => bulkUpdate.mutate({ status: 'archived', reason: 'Bulk archived' })}
                disabled={bulkUpdate.isPending}
                style={{ ...btnBase, color: '#ef4444', background: bulkUpdate.isPending ? '#ef444430' : '#ef444418', padding: '6px 14px' }}
              >{bulkUpdate.isPending ? 'Archiving...' : 'Archive'}</button>
            )}

            <button
              onClick={selectNone}
              style={{ ...btnBase, color: '#94a3b8', background: 'rgba(255,255,255,0.06)', marginLeft: 'auto' }}
            >Clear Selection</button>
          </div>
        )}

        {/* Bulk result toast */}
        {bulkResult && (
          <div style={{
            marginBottom: 12, padding: '8px 14px', borderRadius: 6, fontSize: 12,
            background: bulkResult.startsWith('Error:') ? '#1f0f0f' : '#22c55e18',
            border: `1px solid ${bulkResult.startsWith('Error:') ? '#3a1a1a' : '#22c55e40'}`,
            color: bulkResult.startsWith('Error:') ? '#ef4444' : '#22c55e',
          }}>
            {bulkResult}
          </div>
        )}

        {/* Table */}
        <div style={{ overflow: 'auto', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.03)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                <th style={{ padding: '10px 8px', width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={() => {
                      if (selectedIds.size === filtered.length) selectNone()
                      else selectAll()
                    }}
                    style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                    title="Select all"
                  />
                </th>
                {['#', 'Address', 'Owner', 'Score', 'Persona', 'ARV', 'Phone', 'Source'].map((h) => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#64748b',
                    fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => (
                <LeadRow
                  key={lead.lead_id || i}
                  lead={lead}
                  index={i}
                  isActive={activeLead?.lead_id === lead.lead_id}
                  isSelected={selectedIds.has(lead.lead_id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#334155' }}>
                    {statusFilter || sourceFilter ? 'No leads match this filter.' : 'No leads in queue. Run the pipeline to generate a call list.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {activeLead && <DetailPanel lead={activeLead} />}
      {dialMode && <DialMode leads={filtered} onClose={() => setDialMode(false)} />}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#cbd5e1' }}>{value}</div>
    </div>
  )
}
