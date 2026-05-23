import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { Lead, UnderwritingReport } from '../../api/types'

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString()
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return Math.round(n * 100) + '%'
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

// ── Grade Badge ─────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string | null }) {
  const color = GRADE_COLORS[grade || ''] || '#666'
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 12, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 28, fontWeight: 800, color,
      background: color + '18', border: `2px solid ${color}50`,
    }}>
      {grade || '?'}
    </div>
  )
}

// ── Deal Summary Header ─────────────────────────────────────

function DealHeader({ report, lead }: { report: UnderwritingReport; lead: Lead }) {
  return (
    <div style={{
      background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20,
      display: 'flex', gap: 20, alignItems: 'center', marginBottom: 16,
    }}>
      <GradeBadge grade={report.overall_grade} />
      <div style={{ flex: 1 }}>
        <h3 style={{ color: '#e0e0e0', fontSize: 18, margin: 0 }}>{lead.address_full || '—'}</h3>
        <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>
          {lead.owner_name} &middot; {lead.persona_primary || lead.source}
        </div>
        <div style={{ color: GRADE_COLORS[report.overall_grade || ''] || '#888', fontSize: 13, marginTop: 4, fontWeight: 600 }}>
          {report.recommendation || 'Pending analysis'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>MAO (70%)</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{fmt(report.mao_70)}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
          Conservative: {fmt(report.mao_65)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>ARV</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#a78bfa' }}>{fmt(report.arv_final)}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
          Confidence: {pct(report.arv_confidence)}
        </div>
      </div>
    </div>
  )
}

// ── ARV Comparison ──────────────────────────────────────────

function ArvComparison({ report }: { report: UnderwritingReport }) {
  const sources = parseJson<{ source: string; value: number }[]>(report.arv_sources_json, [])
  const discrepancies = parseJson<{ field: string; spread_pct: number; note: string }[]>(report.discrepancies_json, [])
  const hasDisc = discrepancies.length > 0

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        ARV Comparison
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'PropStream', value: report.arv_propstream },
          { label: 'County Tax (x1.1)', value: report.arv_county ? Math.round(report.arv_county * 1.1) : null },
          { label: 'Final (avg)', value: report.arv_final },
        ].map((s) => (
          <div key={s.label} style={{
            flex: 1, padding: 12, background: '#0a0a0f', borderRadius: 6, textAlign: 'center',
            border: s.label === 'Final (avg)' ? '1px solid #6366f150' : '1px solid #1a1a2e',
          }}>
            <div style={{ fontSize: 11, color: '#666' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.value ? '#e0e0e0' : '#444', marginTop: 4 }}>
              {fmt(s.value)}
            </div>
          </div>
        ))}
      </div>
      {hasDisc && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#2e1a0a', borderRadius: 6, border: '1px solid #4a2a0a' }}>
          {discrepancies.map((d, i) => (
            <div key={i} style={{ color: '#f97316', fontSize: 12 }}>
              {d.note}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Repair Estimate ─────────────────────────────────────────

function RepairEstimate({ report }: { report: UnderwritingReport }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Repair Estimate
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, padding: 12, background: '#0a0a0f', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#666' }}>Low</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80', marginTop: 4 }}>{fmt(report.repair_estimate_low)}</div>
        </div>
        <div style={{ flex: 1, padding: 12, background: '#0a0a0f', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#666' }}>High</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', marginTop: 4 }}>{fmt(report.repair_estimate_high)}</div>
        </div>
        <div style={{ flex: 1, padding: 12, background: '#0a0a0f', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#666' }}>Average</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginTop: 4 }}>
            {report.repair_estimate_low != null && report.repair_estimate_high != null
              ? fmt(Math.round((report.repair_estimate_low + report.repair_estimate_high) / 2))
              : '—'}
          </div>
        </div>
      </div>
      {report.condition_assessment && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#0a0a0f', borderRadius: 6, color: '#999', fontSize: 12 }}>
          {report.condition_assessment}
        </div>
      )}
    </div>
  )
}

// ── Buyer Math Card ─────────────────────────────────────────

function BuyerMath({ report }: { report: UnderwritingReport }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Buyer Math
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Assignment Fee', value: `${fmt(report.assignment_fee_low)} - ${fmt(report.assignment_fee_high)}` },
          { label: 'Holding Costs', value: fmt(report.holding_costs) },
          { label: 'Cash-on-Cash (buyer)', value: report.cash_on_cash_buyer != null ? report.cash_on_cash_buyer + '%' : '—' },
          { label: 'MAO Conservative (65%)', value: fmt(report.mao_65) },
        ].map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a2e' }}>
            <span style={{ color: '#666', fontSize: 12 }}>{r.label}</span>
            <span style={{ color: '#ccc', fontSize: 12, fontWeight: 600 }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Photo Grid ──────────────────────────────────────────────

function PhotoGrid({ report }: { report: UnderwritingReport }) {
  const photos = parseJson<{ url: string; source: string; condition_note: string }[]>(report.photo_urls_json, [])
  if (photos.length === 0) return null

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Property Photos ({photos.length})
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {photos.map((p, i) => (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', background: '#0a0a0f', borderRadius: 6, overflow: 'hidden', textDecoration: 'none' }}>
            {p.source === 'Google Street View' ? (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>
                Street View (click to open)
              </div>
            ) : (
              <img src={p.url} alt={`Property ${i + 1}`} style={{ width: '100%', height: 120, objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            <div style={{ padding: '6px 8px' }}>
              <div style={{ color: '#888', fontSize: 10 }}>{p.source}</div>
              {p.condition_note && <div style={{ color: '#f97316', fontSize: 10 }}>{p.condition_note}</div>}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── External Links ──────────────────────────────────────────

function ExternalLinks({ report }: { report: UnderwritingReport }) {
  const links = [
    { label: 'Google Maps', url: report.street_view_url?.replace('map_action=pano', 'map_action=map') },
    { label: 'Street View', url: report.street_view_url },
    { label: 'Zillow', url: report.zillow_url },
    { label: 'PropStream', url: report.propstream_url },
    { label: 'County Assessor', url: report.county_assessor_url },
  ].filter(l => l.url)

  if (links.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {links.map((l) => (
        <a key={l.label} href={l.url!} target="_blank" rel="noopener noreferrer"
          style={{
            padding: '4px 10px', borderRadius: 4, background: '#6366f118', border: '1px solid #6366f130',
            color: '#818cf8', fontSize: 11, textDecoration: 'none', fontWeight: 500,
          }}>
          {l.label}
        </a>
      ))}
    </div>
  )
}

// ── Situation Summary ───────────────────────────────────────

function SituationSummary({ report }: { report: UnderwritingReport }) {
  if (!report.situation_summary) return null
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Situation Summary
      </div>
      <div style={{ color: '#ccc', fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.6 }}>
        {report.situation_summary}
      </div>
    </div>
  )
}

// ── Call Notes Timeline ─────────────────────────────────────

function NotesTimeline({ notes }: { notes: any[] }) {
  if (!notes || notes.length === 0) return null
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Call Notes ({notes.length})
      </div>
      {notes.map((n: any) => (
        <div key={n.id} style={{ marginBottom: 8, padding: '10px 12px', background: '#0a0a0f', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 3,
              background: n.note_type === 'seller_call' ? '#6366f120' : '#22222e',
              color: n.note_type === 'seller_call' ? '#818cf8' : '#888',
            }}>
              {n.note_type}
            </span>
            <span style={{ fontSize: 10, color: '#555' }}>{new Date(n.created_at).toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
        </div>
      ))}
    </div>
  )
}

// ── Note Input ──────────────────────────────────────────────

function NoteInput({ leadId }: { leadId: string }) {
  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('seller_call')
  const queryClient = useQueryClient()

  const addNote = useMutation({
    mutationFn: () => hermesClient.leads.addNote(leadId, noteType, content),
    onSuccess: () => {
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] })
      queryClient.invalidateQueries({ queryKey: ['underwriting-report', leadId] })
    },
  })

  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Add Note
      </div>
      <select
        value={noteType} onChange={(e) => setNoteType(e.target.value)}
        style={{ width: '100%', padding: '6px 8px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13, marginBottom: 8 }}
      >
        <option value="seller_call">Seller Call</option>
        <option value="analysis">Analysis</option>
        <option value="general">General</option>
      </select>
      <textarea
        value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="Notes from seller conversation..."
        rows={3}
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
    </div>
  )
}

// ── Action Bar ──────────────────────────────────────────────

function ActionBar({ lead, report }: { lead: Lead; report: UnderwritingReport }) {
  const queryClient = useQueryClient()
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [fuDate, setFuDate] = useState('')
  const [fuNotes, setFuNotes] = useState('')

  const updateStatus = useMutation({
    mutationFn: (status: string) => hermesClient.leads.updateStatus(lead.lead_id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underwriting-reports'] })
      queryClient.invalidateQueries({ queryKey: ['underwriting-report', lead.lead_id] })
      queryClient.invalidateQueries({ queryKey: ['lead', lead.lead_id] })
    },
  })

  const refreshReport = useMutation({
    mutationFn: () => hermesClient.underwriting.refresh(lead.lead_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underwriting-report', lead.lead_id] })
    },
  })

  const scheduleFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(lead.lead_id, 'callback', fuDate, fuNotes || undefined),
    onSuccess: () => {
      setShowFollowUp(false); setFuDate(''); setFuNotes('')
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
    },
  })

  const btnStyle = (bg: string, text: string) => ({
    padding: '7px 14px', borderRadius: 4, border: 'none', background: bg,
    color: text, fontSize: 12, fontWeight: 600 as const, cursor: 'pointer' as const,
  })

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => updateStatus.mutate('under_contract')} disabled={updateStatus.isPending}
          style={btnStyle('#22c55e', '#fff')}>Under Contract</button>
        <button onClick={() => setShowFollowUp(!showFollowUp)}
          style={btnStyle('#eab30818', '#eab308')}>{showFollowUp ? 'Cancel' : 'Follow Up'}</button>
        <button onClick={() => updateStatus.mutate('queued')} disabled={updateStatus.isPending}
          style={btnStyle('#6366f118', '#818cf8')}>Back to Queue</button>
        <button onClick={() => updateStatus.mutate('dead')} disabled={updateStatus.isPending}
          style={btnStyle('#ef444418', '#ef4444')}>Dead</button>
        <button onClick={() => refreshReport.mutate()} disabled={refreshReport.isPending}
          style={{ ...btnStyle('#22222e', '#888'), marginLeft: 'auto' }}>
          {refreshReport.isPending ? 'Refreshing...' : 'Refresh Analysis'}
        </button>
      </div>
      {showFollowUp && (
        <div style={{
          padding: 12, background: '#0a0a0f', border: '1px solid #2a2a3e',
          borderRadius: 6, marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Date</label>
            <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13 }} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Notes</label>
            <input value={fuNotes} onChange={(e) => setFuNotes(e.target.value)} placeholder="Optional..."
              style={{ width: '100%', padding: '6px 8px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13 }} />
          </div>
          <button onClick={() => scheduleFollowUp.mutate()} disabled={!fuDate || scheduleFollowUp.isPending}
            style={btnStyle(fuDate ? '#eab308' : '#222', '#000')}>Save</button>
        </div>
      )}
    </div>
  )
}

// ── Full Report View ────────────────────────────────────────

function ReportView({ leadId }: { leadId: string }) {
  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['underwriting-report', leadId],
    queryFn: () => hermesClient.underwriting.report(leadId),
    refetchInterval: 5_000,
  })

  const { data: leadDetail } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => hermesClient.leads.get(leadId),
  })

  const lead = report?.lead || leadDetail

  if (reportLoading) {
    return <div style={{ color: '#666', padding: 32, textAlign: 'center' }}>Loading report...</div>
  }

  if (!report || report.status === 'pending') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ color: '#888', marginBottom: 8 }}>Underwriting analysis in progress...</div>
        <div style={{ width: 40, height: 40, border: '3px solid #1e1e2e', borderTopColor: '#6366f1', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!lead) {
    return <div style={{ color: '#666', padding: 32, textAlign: 'center' }}>Lead data not found.</div>
  }

  return (
    <div>
      <DealHeader report={report} lead={lead as Lead} />
      <ActionBar lead={lead as Lead} report={report} />
      <ExternalLinks report={report} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <ArvComparison report={report} />
        <RepairEstimate report={report} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <BuyerMath report={report} />
        <PhotoGrid report={report} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <SituationSummary report={report} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <NoteInput leadId={leadId} />
          <NotesTimeline notes={(lead as any).notes || []} />
        </div>
      </div>

      {/* Contact info */}
      <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Contact
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: '#555' }}>Phones</div>
            {((lead as any).phone_numbers || []).map((p: any, i: number) => (
              <div key={i} style={{ color: '#ccc', fontSize: 13 }}>
                {p.phone_value} <span style={{ color: '#666' }}>({p.phone_type})</span>
                {p.dnc ? <span style={{ color: '#ef4444', marginLeft: 4 }}>DNC</span> : null}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#555' }}>Emails</div>
            {((lead as any).email_addresses || []).map((e: string, i: number) => (
              <div key={i} style={{ color: '#ccc', fontSize: 13 }}>{e}</div>
            ))}
            {(!(lead as any).email_addresses || (lead as any).email_addresses.length === 0) && (
              <div style={{ color: '#555', fontSize: 12 }}>None</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main App ────────────────────────────────────────────────

export function UnderwritingApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: reports } = useQuery({
    queryKey: ['underwriting-reports'],
    queryFn: () => hermesClient.underwriting.reports(),
    refetchInterval: 15_000,
  })

  const { data: interestedLeads } = useQuery({
    queryKey: ['underwriting-interested'],
    queryFn: () => hermesClient.leads.list({ status: 'interested' }),
    refetchInterval: 15_000,
  })

  const reportLeadIds = new Set((reports || []).map(r => r.lead_id))
  const unreportedInterested = (interestedLeads || []).filter(l => !reportLeadIds.has(l.lead_id))

  const allItems = [
    ...(reports || []).map(r => ({
      lead_id: r.lead_id,
      address: r.address_full || '—',
      name: r.owner_name || '—',
      grade: r.overall_grade,
      status: r.status,
    })),
    ...unreportedInterested.map(l => ({
      lead_id: l.lead_id,
      address: l.address_full || '—',
      name: l.owner_name || '—',
      grade: null,
      status: 'pending',
    })),
  ]

  return (
    <div>
      <h2 style={{ color: '#e0e0e0', fontSize: 20, marginBottom: 8 }}>
        Underwriting
      </h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Full deal analysis for interested leads. Multi-source ARV, repair estimates, honest assessment.
      </p>

      {allItems.length === 0 ? (
        <div style={{
          padding: 32, border: '1px dashed #2a2a3e', borderRadius: 8,
          textAlign: 'center', color: '#444',
        }}>
          <p>No leads in underwriting yet.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Mark leads as "interested" from the call list to auto-trigger underwriting.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>
              Deals ({allItems.length})
            </div>
            {allItems.map((item) => (
              <div
                key={item.lead_id}
                onClick={() => setSelectedId(item.lead_id)}
                style={{
                  padding: '10px 12px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
                  background: selectedId === item.lead_id ? '#1e1e3e' : '#111118',
                  border: `1px solid ${selectedId === item.lead_id ? '#6366f1' : '#1e1e2e'}`,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                {item.grade && (
                  <div style={{
                    width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0,
                    color: GRADE_COLORS[item.grade] || '#666',
                    background: (GRADE_COLORS[item.grade] || '#666') + '18',
                  }}>
                    {item.grade}
                  </div>
                )}
                {!item.grade && (
                  <div style={{
                    width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0, background: '#22222e',
                  }}>
                    <div style={{ width: 10, height: 10, border: '2px solid #555', borderTopColor: '#818cf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.address}
                  </div>
                  <div style={{ color: '#888', fontSize: 11 }}>{item.name}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedId ? (
              <ReportView leadId={selectedId} />
            ) : (
              <div style={{ color: '#444', padding: 32, textAlign: 'center' }}>
                Select a deal to view the full underwriting report.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
