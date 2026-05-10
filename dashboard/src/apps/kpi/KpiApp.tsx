import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { KpiSummary, FollowUp } from '../../api/types'

const OUTCOMES = [
  { value: 'no_answer', label: 'No Answer', color: '#888' },
  { value: 'interested', label: 'Interested', color: '#22c55e' },
  { value: 'not_interested', label: 'Not Interested', color: '#ef4444' },
  { value: 'rescheduled', label: 'Rescheduled', color: '#eab308' },
]

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function FollowUpRow({ fu }: { fu: FollowUp }) {
  const queryClient = useQueryClient()
  const [showOutcome, setShowOutcome] = useState(false)
  const overdue = fu.scheduled_at && new Date(fu.scheduled_at) < new Date()

  const complete = useMutation({
    mutationFn: (outcome: string) => hermesClient.followUps.complete(fu.id, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] })
    },
  })

  return (
    <div style={{
      padding: '12px 16px', background: '#111118', border: '1px solid #1e1e2e',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#ccc', fontSize: 13 }}>{fu.address_full || fu.lead_id}</div>
          <div style={{ color: '#888', fontSize: 11 }}>
            {fu.owner_name} &middot; {fu.follow_up_type}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: overdue ? '#ef4444' : '#eab308', fontSize: 12, fontWeight: 600 }}>
              {new Date(fu.scheduled_at).toLocaleDateString()}
            </div>
            {overdue && <div style={{ color: '#ef4444', fontSize: 10 }}>OVERDUE</div>}
          </div>
          {!showOutcome ? (
            <button
              onClick={() => setShowOutcome(true)}
              style={{
                padding: '5px 10px', borderRadius: 4, border: 'none',
                background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >Done</button>
          ) : null}
        </div>
      </div>

      {fu.notes && <div style={{ color: '#555', fontSize: 11, marginTop: 6 }}>{fu.notes}</div>}

      {showOutcome && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              onClick={() => complete.mutate(o.value)}
              disabled={complete.isPending}
              style={{
                padding: '4px 10px', borderRadius: 4, border: 'none',
                background: o.color + '18', color: o.color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >{o.label}</button>
          ))}
          <button
            onClick={() => setShowOutcome(false)}
            style={{
              padding: '4px 10px', borderRadius: 4, border: 'none',
              background: '#1e1e2e', color: '#666', fontSize: 11, cursor: 'pointer',
            }}
          >Cancel</button>
        </div>
      )}
    </div>
  )
}

export function KpiApp() {
  const queryClient = useQueryClient()
  const [showSchedule, setShowSchedule] = useState(false)
  const [fuLeadId, setFuLeadId] = useState('')
  const [fuDate, setFuDate] = useState('')
  const [fuNotes, setFuNotes] = useState('')

  const { data: kpi, error: kpiError } = useQuery({
    queryKey: ['kpi-summary'],
    queryFn: hermesClient.kpi.summary,
    refetchInterval: 15_000,
  })

  const { data: followUps } = useQuery({
    queryKey: ['follow-ups'],
    queryFn: hermesClient.followUps.list,
    refetchInterval: 30_000,
  })

  const createFollowUp = useMutation({
    mutationFn: () => hermesClient.followUps.create(fuLeadId, 'callback', fuDate, fuNotes || undefined),
    onSuccess: () => {
      setShowSchedule(false)
      setFuLeadId('')
      setFuDate('')
      setFuNotes('')
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
      queryClient.invalidateQueries({ queryKey: ['kpi-summary'] })
    },
  })

  const k = kpi as KpiSummary | undefined
  const inputStyle = {
    width: '100%', padding: '6px 8px', background: '#0a0a0f',
    border: '1px solid #2a2a3e', borderRadius: 4, color: '#ccc', fontSize: 13,
  }

  return (
    <div>
      <h2 style={{ color: '#e0e0e0', fontSize: 20, marginBottom: 8 }}>
        KPI & Follow-Up Orchestrator
      </h2>
      <p style={{ color: '#666', fontSize: 14 }}>
        Track metrics, manage follow-ups, and monitor your pipeline health.
      </p>

      {/* Metric cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16, marginTop: 24,
      }}>
        <MetricCard label="Total Leads" value={kpiError ? '—' : String(k?.total_leads ?? 0)} color="#6366f1" />
        <MetricCard label="Deals Closed" value={String(k?.deals_closed ?? 0)} color="#22c55e" />
        <MetricCard label="Pipeline Value" value={`$${(k?.pipeline_value ?? 0).toLocaleString()}`} color="#eab308" />
        <MetricCard label="Follow-Ups Due" value={String(k?.follow_ups_due ?? 0)} color="#ef4444" />
      </div>

      {/* Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
        <div>
          <h3 style={{ color: '#ccc', fontSize: 14, marginBottom: 12 }}>By Status</h3>
          {Object.entries(k?.by_status || {}).sort((a, b) => b[1] - a[1]).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a2e' }}>
              <span style={{ color: '#ccc', fontSize: 13 }}>{key}</span>
              <span style={{ color: '#888', fontSize: 13 }}>{val}</span>
            </div>
          ))}
          {Object.keys(k?.by_status || {}).length === 0 && <div style={{ color: '#444', fontSize: 13 }}>No data yet</div>}
        </div>
        <div>
          <h3 style={{ color: '#ccc', fontSize: 14, marginBottom: 12 }}>By Source</h3>
          {Object.entries(k?.by_source || {}).sort((a, b) => b[1] - a[1]).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a2e' }}>
              <span style={{ color: '#ccc', fontSize: 13 }}>{key}</span>
              <span style={{ color: '#888', fontSize: 13 }}>{val}</span>
            </div>
          ))}
          {Object.keys(k?.by_source || {}).length === 0 && <div style={{ color: '#444', fontSize: 13 }}>No data yet</div>}
        </div>
      </div>

      {/* Follow-ups section */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ color: '#ccc', fontSize: 14, margin: 0 }}>
            Pending Follow-Ups
            {followUps && followUps.length > 0 && (
              <span style={{ color: '#666', marginLeft: 6 }}>({followUps.length})</span>
            )}
          </h3>
          <button
            onClick={() => setShowSchedule(!showSchedule)}
            style={{
              padding: '5px 12px', borderRadius: 4, border: 'none',
              background: showSchedule ? '#1e1e2e' : '#eab30818', color: showSchedule ? '#888' : '#eab308',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {showSchedule ? 'Cancel' : '+ Schedule'}
          </button>
        </div>

        {/* Quick schedule form */}
        {showSchedule && (
          <div style={{
            padding: 16, background: '#111118', border: '1px solid #1e1e2e',
            borderRadius: 8, marginBottom: 12,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Lead ID</label>
                <input value={fuLeadId} onChange={(e) => setFuLeadId(e.target.value)} placeholder="lead_id..." style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Date</label>
                <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <input
              value={fuNotes}
              onChange={(e) => setFuNotes(e.target.value)}
              placeholder="Notes (optional)..."
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <button
              onClick={() => createFollowUp.mutate()}
              disabled={!fuLeadId.trim() || !fuDate || createFollowUp.isPending}
              style={{
                padding: '7px 16px', borderRadius: 4, border: 'none',
                background: fuLeadId.trim() && fuDate ? '#eab308' : '#222',
                color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {createFollowUp.isPending ? 'Saving...' : 'Schedule Follow-Up'}
            </button>
          </div>
        )}

        {followUps && followUps.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {followUps.map((fu) => <FollowUpRow key={fu.id} fu={fu} />)}
          </div>
        ) : (
          <div style={{
            padding: 32, border: '1px dashed #2a2a3e', borderRadius: 8,
            textAlign: 'center', color: '#444',
          }}>
            No follow-ups scheduled. Follow-ups appear here after you mark leads for callback.
          </div>
        )}
      </div>
    </div>
  )
}
