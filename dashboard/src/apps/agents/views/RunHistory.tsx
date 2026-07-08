import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { AgentRun } from '../../../api/types'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'

const statusGradients: Record<string, { dot: string; glow: string; text: string }> = {
  running: { dot: 'linear-gradient(135deg, #6366f1, #818cf8)', glow: 'rgba(99,102,241,0.5)', text: '#818cf8' },
  completed: { dot: 'linear-gradient(135deg, #22c55e, #4ade80)', glow: 'rgba(34,197,94,0.5)', text: '#4ade80' },
  failed: { dot: 'linear-gradient(135deg, #ef4444, #f87171)', glow: 'rgba(239,68,68,0.5)', text: '#f87171' },
}

function formatTime(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function duration(start: string, end: string | null): string {
  if (!end) return 'running...'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function RunHistory() {
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: runs } = useQuery({
    queryKey: ['agent-runs', agentFilter],
    queryFn: () => agentFilter
      ? hermesClient.agents.runs(agentFilter)
      : Promise.all([
          hermesClient.agents.runs('scout'),
          hermesClient.agents.runs('dispatcher'),
          hermesClient.agents.runs('analyst'),
          hermesClient.agents.runs('operator'),
          hermesClient.agents.runs('supervisor'),
        ]).then((r) => r.flat().sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 50)),
    refetchInterval: 10_000,
  })

  return (
    <div>
      {/* Filter pills */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20, padding: 3, borderRadius: 12,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
        width: 'fit-content',
      }}>
        {[
          { value: '', label: 'All' },
          { value: 'scout', label: 'Scout' },
          { value: 'dispatcher', label: 'Dispatcher' },
          { value: 'analyst', label: 'Analyst' },
          { value: 'operator', label: 'Operator' },
          { value: 'supervisor', label: 'Supervisor' },
        ].map((a) => (
          <button
            key={a.value}
            onClick={() => setAgentFilter(a.value)}
            className={agentFilter === a.value ? 'glass-button glass-button-active' : 'glass-button'}
            style={{
              padding: '7px 14px', fontSize: 12,
              color: agentFilter === a.value ? '#c7d2fe' : '#64748b',
              fontWeight: agentFilter === a.value ? 600 : 400,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {(!runs || runs.length === 0) && (
        <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
          <Terminal size={32} color="#334155" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: '#475569' }}>No runs yet</div>
          <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>
            Trigger an agent from the Overview tab
          </div>
        </div>
      )}

      {/* Run entries */}
      {runs?.map((run: AgentRun, idx: number) => {
        const expanded = expandedId === run.run_id
        const sg = statusGradients[run.status] || statusGradients.completed
        let logs: { t: string; msg: string }[] = []
        try { logs = JSON.parse(run.log_lines_json || '[]') } catch {}

        return (
          <div
            key={run.run_id}
            className={`glass-card ${expanded ? 'glass-card-active' : ''}`}
            style={{
              marginBottom: 8, overflow: 'hidden',
              animation: `fadeIn 0.3s ease-out ${Math.min(idx * 0.04, 0.4)}s both`,
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 20px', cursor: 'pointer',
              }}
              onClick={() => setExpandedId(expanded ? null : run.run_id)}
            >
              {/* Status dot with glow */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 5,
                  background: sg.dot,
                  boxShadow: `0 0 8px ${sg.glow}`,
                  ...(run.status === 'running' ? { animation: 'dotPulse 1.5s ease-in-out infinite' } : {}),
                }} />
              </div>

              <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 110, fontWeight: 500 }}>
                {run.agent_type.replace(/_/g, ' ')}
              </span>

              <span style={{ fontSize: 11, fontWeight: 600, color: sg.text }}>
                {run.status}
              </span>

              <span style={{ fontSize: 11, color: '#475569' }}>
                {run.phase}
              </span>

              <div style={{ flex: 1 }} />

              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
                <span>{run.leads_scanned} scanned</span>
                <span>{run.proposals_created} proposals</span>
                {run.ai_calls_made > 0 && <span>{run.ai_calls_made} AI</span>}
              </div>

              <span style={{ fontSize: 11, color: '#334155' }}>
                {formatTime(run.started_at)}
                <span style={{ color: '#1e293b', margin: '0 4px' }}>&middot;</span>
                {duration(run.started_at, run.completed_at)}
              </span>

              {!run.ai_available && (
                <span style={{
                  fontSize: 9, padding: '3px 8px', borderRadius: 6, letterSpacing: '0.05em',
                  background: 'rgba(251,191,36,0.08)', color: '#fbbf24', fontWeight: 600, textTransform: 'uppercase',
                }}>
                  rules-only
                </span>
              )}

              {expanded
                ? <ChevronUp size={14} color="#475569" />
                : <ChevronDown size={14} color="#334155" />
              }
            </div>

            {expanded && (
              <div style={{
                padding: '0 20px 20px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                animation: 'fadeIn 0.2s ease-out',
              }}>
                {run.error && (
                  <div style={{
                    margin: '16px 0', padding: 14, borderRadius: 12,
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    fontSize: 12, color: '#fca5a5',
                  }}>
                    <span style={{ fontWeight: 600 }}>Error:</span> {run.error}
                  </div>
                )}

                {/* Log viewer — terminal style with glass */}
                <div style={{
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 12, padding: 16, marginTop: 16,
                  maxHeight: 320, overflow: 'auto',
                  border: '1px solid rgba(255,255,255,0.04)',
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: 11, lineHeight: 2,
                }}>
                  {/* Terminal header */}
                  <div style={{
                    display: 'flex', gap: 6, marginBottom: 12, paddingBottom: 10,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: 5, background: '#ef4444' }} />
                    <div style={{ width: 10, height: 10, borderRadius: 5, background: '#eab308' }} />
                    <div style={{ width: 10, height: 10, borderRadius: 5, background: '#22c55e' }} />
                    <span style={{ fontSize: 10, color: '#334155', marginLeft: 8 }}>
                      {run.agent_type} &mdash; {run.run_id}
                    </span>
                  </div>

                  {logs.length === 0 && (
                    <span style={{ color: '#334155' }}>No log entries</span>
                  )}
                  {logs.map((entry, i) => (
                    <div key={i}>
                      <span style={{ color: '#334155' }}>
                        {new Date(entry.t).toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                      <span style={{ color: '#475569', margin: '0 6px' }}>&rsaquo;</span>
                      <span style={{ color: '#94a3b8' }}>{entry.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
