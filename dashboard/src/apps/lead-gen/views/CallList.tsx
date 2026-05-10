import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import { useLeadStore } from '../../../store/lead-store'
import { DialMode } from './DialMode'
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
  { status: 'contacted', label: 'No Answer', color: '#888' },
  { status: 'interested', label: 'Interested', color: '#22c55e' },
  { status: 'not_interested', label: 'Not Interested', color: '#ef4444' },
  { status: 'follow_up', label: 'Follow Up', color: '#eab308' },
] as const

const btnBase = {
  border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600 as const,
  cursor: 'pointer', padding: '5px 10px',
}

function LeadRow({ lead, index, isActive }: { lead: Lead; index: number; isActive: boolean }) {
  const setActiveLead = useLeadStore((s) => s.setActiveLead)
  const tier = lead.motivation_tier || ''
  const tierColor = TIER_COLORS[tier] || '#666'

  return (
    <tr
      onClick={() => setActiveLead(lead)}
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid #1e1e2e',
        background: isActive ? '#1a1a2e' : 'transparent',
      }}
    >
      <td style={{ padding: '10px 12px', color: '#ccc', fontSize: 13 }}>{index + 1}</td>
      <td style={{ padding: '10px 12px', color: '#e0e0e0', fontSize: 13 }}>
        {lead.address_street || lead.address_full || '—'}
        <div style={{ fontSize: 11, color: '#666' }}>
          {[lead.address_city, lead.address_state, lead.address_zip].filter(Boolean).join(', ')}
        </div>
      </td>
      <td style={{ padding: '10px 12px', color: '#bbb', fontSize: 13 }}>{lead.owner_name || '—'}</td>
      <td style={{ padding: '10px 12px' }}>
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 600, color: tierColor, background: tierColor + '20',
        }}>
          {tier} {lead.motivation_score ?? ''}
        </span>
      </td>
      <td style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>{lead.persona_primary || '—'}</td>
      <td style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>
        {lead.arv_estimate ? `$${lead.arv_estimate.toLocaleString()}` : '—'}
      </td>
      <td style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>
        {lead.callable_phones.length > 0
          ? lead.callable_phones[0].phone_value
          : <span style={{ color: '#ef4444', fontSize: 11 }}>no phone</span>}
      </td>
      <td style={{ padding: '10px 12px', color: '#555', fontSize: 11 }}>{lead.source || '—'}</td>
    </tr>
  )
}

function DetailPanel({ lead }: { lead: Lead }) {
  const queryClient = useQueryClient()
  const setActiveLead = useLeadStore((s) => s.setActiveLead)
  const [note, setNote] = useState('')
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [fuDate, setFuDate] = useState('')

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
    width: '100%', padding: '6px 8px', background: '#0a0a0f',
    border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 12,
  }

  return (
    <div style={{
      width: 380, background: '#111118', border: '1px solid #1e1e2e',
      borderRadius: 8, padding: 20, position: 'sticky', top: 24,
      maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ color: '#e0e0e0', fontSize: 16, margin: 0 }}>Lead Detail</h3>
        <button
          onClick={() => setActiveLead(null)}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}
        >&times;</button>
      </div>

      <p style={{ fontWeight: 600, color: '#e0e0e0', fontSize: 14, margin: '0 0 2px' }}>{lead.address_full}</p>
      <p style={{ color: '#888', fontSize: 13, margin: '0 0 16px' }}>{lead.owner_name}</p>

      {/* Call disposition buttons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 6 }}>Call Result</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DISPOSITIONS.map((d) => (
            <button
              key={d.status}
              onClick={() => updateStatus.mutate({ status: d.status })}
              disabled={updateStatus.isPending}
              style={{ ...btnBase, color: d.color, background: d.color + '18', }}
            >
              {d.label}
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
        <div style={{ marginBottom: 16, padding: 10, background: '#0a0a0f', borderRadius: 6, border: '1px solid #2a2a3e' }}>
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
              style={{ ...btnBase, background: '#1e1e2e', color: '#888' }}
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
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>Distress Signals</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {lead.distress_signals.map((sig) => (
              <span key={sig} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, background: '#ef444420', color: '#ef4444' }}>{sig}</span>
            ))}
          </div>
        </div>
      )}

      {/* Contact */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
        {lead.callable_phones.length > 0 ? (
          lead.callable_phones.map((p, i) => (
            <div key={i} style={{ color: '#ccc', fontSize: 13 }}>
              {p.phone_value} <span style={{ color: '#555' }}>({p.phone_type})</span>
              {p.dnc ? <span style={{ color: '#ef4444', marginLeft: 4 }}>DNC</span> : null}
            </div>
          ))
        ) : (
          <div style={{ color: '#ef4444', fontSize: 12 }}>Needs skip trace</div>
        )}
      </div>

      {/* Source + Router */}
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>Source</div>
      <div style={{ color: '#aaa', fontSize: 12, marginBottom: 12 }}>{lead.source || '—'}</div>

      {lead.router_reason && (
        <>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>Router Reason</div>
          <div style={{ color: '#777', fontSize: 11 }}>{lead.router_reason}</div>
        </>
      )}
    </div>
  )
}

export function CallList() {
  const [statusFilter, setStatusFilter] = useState('')
  const [listFilter, setListFilter] = useState('')
  const [dialMode, setDialMode] = useState(false)
  const queryClient = useQueryClient()

  const { data: leads, isLoading, error } = useQuery({
    queryKey: ['queue-all', statusFilter],
    queryFn: () => hermesClient.leads.list({
      status: statusFilter || undefined,
      limit: 500,
    }),
    refetchInterval: 15_000,
  })

  const activeLead = useLeadStore((s) => s.activeLead)

  const listNames = useMemo(() => {
    if (!leads) return []
    const names = new Set<string>()
    for (const l of leads) {
      if (l.last_list_name) names.add(l.last_list_name)
    }
    return Array.from(names).sort()
  }, [leads])

  const filtered = useMemo(() => {
    if (!leads) return []
    if (!listFilter) return leads
    return leads.filter((l) => l.last_list_name === listFilter)
  }, [leads, listFilter])

  if (isLoading) return <div style={{ color: '#666' }}>Loading call list...</div>

  if (error) {
    return (
      <div>
        <h2 style={{ color: '#e0e0e0', fontSize: 20, marginBottom: 16 }}>Call List</h2>
        <div style={{ padding: 24, background: '#1a1a2e', borderRadius: 8, border: '1px solid #2a2a3e', color: '#888' }}>
          <p>Connect to Hermes to load the call list.</p>
          <p style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
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
          <h2 style={{ color: '#e0e0e0', fontSize: 20, margin: 0 }}>
            Call List
            <span style={{ color: '#666', fontSize: 14, marginLeft: 8 }}>
              ({filtered.length}{listFilter || statusFilter ? ` of ${leads?.length ?? 0}` : ''})
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
              style={{ ...btnBase, background: '#1a1a2e', color: '#888', padding: '6px 12px' }}
            >Refresh</button>
          </div>
        </div>

        {/* List selector */}
        {listNames.length > 1 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.5 }}>List</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                onClick={() => setListFilter('')}
                style={{
                  ...btnBase, fontSize: 11,
                  background: !listFilter ? '#6366f120' : '#111118',
                  color: !listFilter ? '#6366f1' : '#666',
                  border: `1px solid ${!listFilter ? '#6366f140' : '#1e1e2e'}`,
                }}
              >All Lists</button>
              {listNames.map((name) => {
                const count = leads?.filter((l) => l.last_list_name === name).length ?? 0
                return (
                  <button
                    key={name}
                    onClick={() => setListFilter(name)}
                    style={{
                      ...btnBase, fontSize: 11,
                      background: listFilter === name ? '#6366f120' : '#111118',
                      color: listFilter === name ? '#6366f1' : '#666',
                      border: `1px solid ${listFilter === name ? '#6366f140' : '#1e1e2e'}`,
                    }}
                  >{name} <span style={{ color: '#444', marginLeft: 2 }}>({count})</span></button>
                )
              })}
            </div>
          </div>
        )}

        {/* Status filter bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              style={{
                ...btnBase,
                background: statusFilter === f.value ? '#6366f120' : '#111118',
                color: statusFilter === f.value ? '#6366f1' : '#666',
                border: `1px solid ${statusFilter === f.value ? '#6366f140' : '#1e1e2e'}`,
              }}
            >{f.label}</button>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflow: 'auto', borderRadius: 8, border: '1px solid #1e1e2e' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#111118' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3e' }}>
                {['#', 'Address', 'Owner', 'Score', 'Persona', 'ARV', 'Phone', 'Source'].map((h) => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#666',
                    fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => (
                <LeadRow key={lead.lead_id || i} lead={lead} index={i} isActive={activeLead?.lead_id === lead.lead_id} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#444' }}>
                    {statusFilter || listFilter ? 'No leads match this filter.' : 'No leads in queue. Run the pipeline to generate a call list.'}
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
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#ccc' }}>{value}</div>
    </div>
  )
}
