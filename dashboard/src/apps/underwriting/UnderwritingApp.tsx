import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { Lead } from '../../api/types'

function DealMath({ lead }: { lead: Lead }) {
  const arv = lead.arv_estimate ?? 0
  const [repairLow, setRepairLow] = useState(String((lead as any).repair_estimate_low ?? ''))
  const [repairHigh, setRepairHigh] = useState(String((lead as any).repair_estimate_high ?? ''))
  const [arvOverride, setArvOverride] = useState(String(arv || ''))

  const arvVal = Number(arvOverride) || 0
  const repairAvg = ((Number(repairLow) || 0) + (Number(repairHigh) || 0)) / 2
  const mao = Math.round(arvVal * 0.7 - repairAvg)
  const spread = Math.round(arvVal - mao - repairAvg)

  const inputStyle = {
    width: '100%', padding: '6px 8px', background: '#0a0a0f', border: '1px solid #2a2a3e',
    borderRadius: 4, color: '#ccc', fontSize: 13,
  }

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Deal Math
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: '#555' }}>ARV</label>
          <input style={inputStyle} value={arvOverride} onChange={(e) => setArvOverride(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#555' }}>MAO (70% rule)</label>
          <div style={{ padding: '6px 8px', fontSize: 16, fontWeight: 700, color: '#22c55e' }}>
            ${mao.toLocaleString()}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#555' }}>Repair Low</label>
          <input style={inputStyle} value={repairLow} onChange={(e) => setRepairLow(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#555' }}>Repair High</label>
          <input style={inputStyle} value={repairHigh} onChange={(e) => setRepairHigh(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', background: spread > 0 ? '#1a2e1a' : '#2e1a1a', borderRadius: 6, textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Est. Spread: </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: spread > 0 ? '#4ade80' : '#ef4444' }}>
          ${spread.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

function NoteInput({ leadId }: { leadId: string }) {
  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('seller_call')
  const queryClient = useQueryClient()

  const addNote = useMutation({
    mutationFn: () => hermesClient.leads.addNote(leadId, noteType, content),
    onSuccess: () => {
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Add Note
      </div>
      <select
        value={noteType}
        onChange={(e) => setNoteType(e.target.value)}
        style={{ width: '100%', padding: '6px 8px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13, marginBottom: 8 }}
      >
        <option value="seller_call">Seller Call</option>
        <option value="analysis">Analysis</option>
        <option value="general">General</option>
      </select>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Notes from seller conversation..."
        rows={4}
        style={{ width: '100%', padding: '8px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13, resize: 'vertical' }}
      />
      <button
        onClick={() => addNote.mutate()}
        disabled={!content.trim() || addNote.isPending}
        style={{
          marginTop: 8, padding: '6px 16px', borderRadius: 4, border: 'none',
          background: !content.trim() ? '#333' : '#6366f1', color: '#fff',
          fontSize: 12, cursor: 'pointer',
        }}
      >
        {addNote.isPending ? 'Saving...' : 'Save Note'}
      </button>
      {addNote.isError && (
        <div style={{ padding: '6px 10px', borderRadius: 4, marginTop: 6, background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 11 }}>
          Failed: {addNote.error instanceof Error ? addNote.error.message : String(addNote.error)}
        </div>
      )}
    </div>
  )
}

function LeadWorkbench({ lead }: { lead: any }) {
  const queryClient = useQueryClient()
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [fuDate, setFuDate] = useState('')
  const [fuNotes, setFuNotes] = useState('')

  const updateStatus = useMutation({
    mutationFn: (status: string) => hermesClient.leads.updateStatus(lead.lead_id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underwriting-leads'] })
      queryClient.invalidateQueries({ queryKey: ['underwriting-active'] })
      queryClient.invalidateQueries({ queryKey: ['lead', lead.lead_id] })
    },
  })

  const scheduleFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(lead.lead_id, 'callback', fuDate, fuNotes || undefined),
    onSuccess: () => {
      setShowFollowUp(false)
      setFuDate('')
      setFuNotes('')
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  const inputStyle = {
    width: '100%', padding: '6px 8px', background: '#0a0a0f',
    border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13,
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ color: '#e0e0e0', fontSize: 16, margin: 0 }}>{lead.address_full || '—'}</h3>
          <div style={{ color: '#888', fontSize: 13 }}>{lead.owner_name} &middot; {lead.status}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowFollowUp(!showFollowUp)}
            style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: '#eab30818', color: '#eab308', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            {showFollowUp ? 'Cancel' : 'Follow Up'}
          </button>
          <button
            onClick={() => updateStatus.mutate('under_contract')}
            disabled={updateStatus.isPending}
            style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: updateStatus.isPending ? '#16a34a' : '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: updateStatus.isPending ? 0.7 : 1 }}
          >
            {updateStatus.isPending ? 'Updating...' : 'Under Contract'}
          </button>
          <button
            onClick={() => updateStatus.mutate('dead')}
            disabled={updateStatus.isPending}
            style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: updateStatus.isPending ? '#dc2626' : '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: updateStatus.isPending ? 0.7 : 1 }}
          >
            {updateStatus.isPending ? 'Updating...' : 'Dead'}
          </button>
        </div>
      </div>

      {(updateStatus.isError || scheduleFollowUp.isError) && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {updateStatus.isError && `Status update failed: ${updateStatus.error instanceof Error ? updateStatus.error.message : String(updateStatus.error)}`}
          {scheduleFollowUp.isError && `Follow-up failed: ${scheduleFollowUp.error instanceof Error ? scheduleFollowUp.error.message : String(scheduleFollowUp.error)}`}
        </div>
      )}

      {showFollowUp && (
        <div style={{
          padding: 12, background: '#0a0a0f', border: '1px solid #2a2a3e',
          borderRadius: 6, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Date</label>
            <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Notes</label>
            <input value={fuNotes} onChange={(e) => setFuNotes(e.target.value)} placeholder="Optional..." style={inputStyle} />
          </div>
          <button
            onClick={() => scheduleFollowUp.mutate()}
            disabled={!fuDate || scheduleFollowUp.isPending}
            style={{
              padding: '7px 16px', borderRadius: 4, border: 'none',
              background: fuDate ? '#eab308' : '#222', color: '#000',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >Save</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <DealMath lead={lead} />
          <div style={{ marginTop: 16 }}>
            <NoteInput leadId={lead.lead_id} />
          </div>
        </div>
        <div>
          <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Property Details</div>
            <DetailRow label="Type" value={lead.property_type} />
            <DetailRow label="Status" value={lead.status} />
            <DetailRow label="Persona" value={lead.persona_primary} />
            <DetailRow label="Score" value={`${lead.motivation_score ?? '—'} (${lead.motivation_tier ?? '—'})`} />
            <DetailRow label="Router" value={`${lead.router_decision} — ${lead.router_reason}`} />
            <DetailRow label="Source" value={lead.source} />
          </div>

          <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact</div>
            {(lead.phone_numbers || []).map((p: any, i: number) => (
              <div key={i} style={{ color: '#ccc', fontSize: 13, marginBottom: 4 }}>
                {p.phone_value} <span style={{ color: '#666' }}>({p.phone_type})</span>
                {p.dnc ? <span style={{ color: '#ef4444', marginLeft: 4 }}>DNC</span> : null}
              </div>
            ))}
            {(!lead.phone_numbers || lead.phone_numbers.length === 0) && (
              <div style={{ color: '#ef4444', fontSize: 12 }}>No phones — needs skip trace</div>
            )}
          </div>

          {lead.notes && lead.notes.length > 0 && (
            <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</div>
              {lead.notes.map((n: any) => (
                <div key={n.id} style={{ marginBottom: 8, padding: '8px', background: '#0a0a0f', borderRadius: 4 }}>
                  <div style={{ fontSize: 11, color: '#555' }}>{n.note_type} &middot; {new Date(n.created_at).toLocaleString()}</div>
                  <div style={{ fontSize: 13, color: '#ccc', marginTop: 4 }}>{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a2e' }}>
      <span style={{ color: '#666', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#ccc', fontSize: 12 }}>{value ?? '—'}</span>
    </div>
  )
}

export function UnderwritingApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: leads } = useQuery({
    queryKey: ['underwriting-leads'],
    queryFn: () => hermesClient.leads.list({ status: 'interested' }),
    refetchInterval: 15_000,
  })

  const { data: uwLeads } = useQuery({
    queryKey: ['underwriting-active'],
    queryFn: () => hermesClient.leads.list({ status: 'underwriting' }),
    refetchInterval: 15_000,
  })

  const allLeads = [...(leads || []), ...(uwLeads || [])]

  const { data: selectedLead } = useQuery({
    queryKey: ['lead', selectedId],
    queryFn: () => hermesClient.leads.get(selectedId!),
    enabled: !!selectedId,
  })

  return (
    <div>
      <h2 style={{ color: '#e0e0e0', fontSize: 20, marginBottom: 8 }}>
        Underwriting & Strategy Router
      </h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Evaluate interested leads, analyze deals, and prep contracts.
      </p>

      {allLeads.length === 0 && !selectedLead ? (
        <div style={{
          padding: 32, border: '1px dashed #2a2a3e', borderRadius: 8,
          textAlign: 'center', color: '#444',
        }}>
          <p>No leads in underwriting yet.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Mark leads as "interested" from the call list to begin underwriting.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ width: 260, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>
              Deals ({allLeads.length})
            </div>
            {allLeads.map((lead) => (
              <div
                key={lead.lead_id}
                onClick={() => setSelectedId(lead.lead_id)}
                style={{
                  padding: '10px 12px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
                  background: selectedId === lead.lead_id ? '#1e1e3e' : '#111118',
                  border: `1px solid ${selectedId === lead.lead_id ? '#6366f1' : '#1e1e2e'}`,
                }}
              >
                <div style={{ color: '#ccc', fontSize: 13 }}>{lead.address_full || '—'}</div>
                <div style={{ color: '#888', fontSize: 11 }}>
                  {lead.owner_name} &middot; {lead.status}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedLead ? (
              <LeadWorkbench lead={selectedLead} />
            ) : (
              <div style={{ color: '#444', padding: 32, textAlign: 'center' }}>
                Select a lead to begin underwriting.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
