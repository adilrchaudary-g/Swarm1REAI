import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { Proposal } from '../../../api/types'
import { Check, X, RotateCcw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'

const priorityConfig: Record<string, { color: string; bg: string }> = {
  critical: { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  high: { color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
  medium: { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  low: { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
}

const statusConfig: Record<string, { color: string; bg: string }> = {
  pending: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  approved: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  denied: { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  revised: { color: '#818cf8', bg: 'rgba(129,140,248,0.1)' },
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ProposalQueue() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [reviseId, setReviseId] = useState<number | null>(null)
  const [reviseNotes, setReviseNotes] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const { data: proposals } = useQuery({
    queryKey: ['agent-proposals', statusFilter, agentFilter],
    queryFn: () => hermesClient.agents.proposals.list({
      status: statusFilter || undefined,
      agent_type: agentFilter || undefined,
      limit: 100,
    }),
    refetchInterval: 10_000,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-proposals'] })
    queryClient.invalidateQueries({ queryKey: ['agent-pending-count'] })
    queryClient.invalidateQueries({ queryKey: ['agent-pending-proposals'] })
  }

  const approve = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.approve(id),
    onSuccess: invalidateAll,
  })

  const deny = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.deny(id),
    onSuccess: invalidateAll,
  })

  const revise = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      hermesClient.agents.proposals.revise(id, notes),
    onSuccess: () => { invalidateAll(); setReviseId(null); setReviseNotes('') },
  })

  const bulkApprove = useMutation({
    mutationFn: (ids: number[]) => hermesClient.agents.proposals.bulkApprove(ids),
    onSuccess: () => { invalidateAll(); setSelectedIds(new Set()) },
  })

  const bulkDeny = useMutation({
    mutationFn: (ids: number[]) => hermesClient.agents.proposals.bulkDeny(ids),
    onSuccess: () => { invalidateAll(); setSelectedIds(new Set()) },
  })

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (!proposals) return
    const pendingIds = proposals.filter((p) => p.status === 'pending').map((p) => p.id)
    setSelectedIds(new Set(pendingIds))
  }

  return (
    <div>
      {/* Filters — glass pill bar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{
          display: 'flex', gap: 4, padding: 3, borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          {['pending', 'approved', 'denied', 'revised', ''].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={statusFilter === s ? 'glass-button glass-button-active' : 'glass-button'}
              style={{
                padding: '7px 14px', fontSize: 12,
                color: statusFilter === s ? '#c7d2fe' : '#64748b',
                fontWeight: statusFilter === s ? 600 : 400,
              }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 12,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            color: '#94a3b8', backdropFilter: 'blur(10px)',
          }}
        >
          <option value="">All agents</option>
          <option value="scout">Scout</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="analyst">Analyst</option>
          <option value="operator">Operator</option>
          <option value="supervisor">Supervisor</option>
        </select>

        {selectedIds.size > 0 && statusFilter === 'pending' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={() => bulkApprove.mutate([...selectedIds])}
              className="glass-button"
              style={{
                padding: '8px 16px', fontSize: 12,
                borderColor: 'rgba(74,222,128,0.3)',
                background: 'rgba(74,222,128,0.08)',
                color: '#4ade80', fontWeight: 600,
              }}
            >
              <Check size={12} style={{ marginRight: 4 }} />
              Approve {selectedIds.size}
            </button>
            <button
              onClick={() => bulkDeny.mutate([...selectedIds])}
              className="glass-button"
              style={{
                padding: '8px 16px', fontSize: 12,
                borderColor: 'rgba(248,113,113,0.3)',
                background: 'rgba(248,113,113,0.08)',
                color: '#f87171', fontWeight: 600,
              }}
            >
              <X size={12} style={{ marginRight: 4 }} />
              Deny {selectedIds.size}
            </button>
          </div>
        )}
      </div>

      {statusFilter === 'pending' && proposals && proposals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={selectAll}
            className="glass-button"
            style={{ padding: '6px 14px', fontSize: 11, color: '#64748b' }}
          >
            Select all pending
          </button>
        </div>
      )}

      {/* Empty state */}
      {(!proposals || proposals.length === 0) && (
        <div className="glass-card" style={{
          padding: 60, textAlign: 'center',
        }}>
          <Sparkles size={32} color="#334155" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: '#475569' }}>No proposals found</div>
          <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>
            Agents will surface proposals here for your review
          </div>
        </div>
      )}

      {/* Proposals */}
      {proposals?.map((p: Proposal, idx: number) => {
        const expanded = expandedId === p.id
        const isRevising = reviseId === p.id
        const pri = priorityConfig[p.priority] || priorityConfig.medium
        const stat = statusConfig[p.status] || statusConfig.pending
        let payload: Record<string, unknown> = {}
        try { payload = JSON.parse(p.payload_json) } catch {}
        const revisionNotes: string = p.revision_notes || ''
        const escalation = payload.escalation as { options?: Array<{ label: string; description: string }>; recommendation?: string } | undefined
        const originalCount = typeof payload.original_count === 'number' ? payload.original_count : 0

        return (
          <div
            key={p.id}
            className={`glass-card ${expanded ? 'glass-card-active' : ''}`}
            style={{
              marginBottom: 8,
              overflow: 'hidden',
              animation: `fadeIn 0.3s ease-out ${Math.min(idx * 0.03, 0.3)}s both`,
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 20px', cursor: 'pointer',
              }}
              onClick={() => setExpandedId(expanded ? null : p.id)}
            >
              {p.status === 'pending' && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                />
              )}

              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                padding: '3px 8px', borderRadius: 6, letterSpacing: '0.03em',
                color: pri.color, background: pri.bg,
              }}>
                {p.priority}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: '#e2e8f0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {p.title}
                </div>
              </div>

              <span style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>
                {p.agent_type.replace(/_/g, ' ')}
              </span>

              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                color: stat.color, background: stat.bg, letterSpacing: '0.03em',
              }}>
                {p.status}
              </span>

              <span style={{ fontSize: 11, color: '#334155', flexShrink: 0 }}>
                {timeAgo(p.created_at)}
              </span>

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
                {p.description && (
                  <div style={{
                    fontSize: 12, color: '#94a3b8', margin: '16px 0',
                    lineHeight: 1.7, whiteSpace: 'pre-wrap',
                  }}>
                    {p.description}
                  </div>
                )}

                {/* Payload display — frosted code block */}
                <div style={{
                  background: 'rgba(0,0,0,0.3)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 12, padding: 16, marginBottom: 16,
                  border: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 11, fontFamily: "'SF Mono', 'Fira Code', monospace",
                }}>
                  <div style={{ fontSize: 9, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Payload
                  </div>
                  {Object.entries(payload).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 2, color: '#94a3b8' }}>
                      <span style={{ color: '#818cf8' }}>{k}</span>
                      <span style={{ color: '#475569' }}>: </span>
                      <span>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>

                {revisionNotes.length > 0 && (
                  <div style={{
                    background: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.15)',
                    borderRadius: 12, padding: 14, marginBottom: 16,
                    fontSize: 12, color: '#a5b4fc',
                  }}>
                    <span style={{ fontWeight: 600 }}>Revision notes:</span> {revisionNotes}
                  </div>
                )}

                {/* Escalation options from Meta Reviewer */}
                {escalation?.options && escalation.options.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{
                      fontSize: 10, color: '#475569', marginBottom: 10,
                      textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
                    }}>
                      Escalation Options
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {escalation.options.map((opt, oi) => (
                        <div key={oi} style={{
                          padding: '12px 16px', borderRadius: 12,
                          background: oi === 0 ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${oi === 0 ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)'}`,
                          display: 'flex', alignItems: 'center', gap: 12,
                        }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: oi === 0 ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255,255,255,0.04)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700,
                            color: oi === 0 ? '#fff' : '#64748b',
                            flexShrink: 0,
                          }}>
                            {oi + 1}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: oi === 0 ? '#c7d2fe' : '#94a3b8' }}>
                              {opt.label}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              {opt.description}
                            </div>
                          </div>
                          {oi === 0 && (
                            <span style={{
                              fontSize: 9, padding: '3px 8px', borderRadius: 6,
                              background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                              Recommended
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {originalCount > 0 && (
                      <div style={{
                        marginTop: 10, fontSize: 11, color: '#475569',
                        padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.1)',
                      }}>
                        Approving will deny {originalCount} noisy individual proposals and execute the recommended action.
                      </div>
                    )}
                  </div>
                )}

                {p.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => approve.mutate(p.id)}
                      disabled={approve.isPending}
                      style={{
                        padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                        color: '#fff', fontSize: 13, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                        boxShadow: '0 4px 16px rgba(34,197,94,0.3)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      onClick={() => deny.mutate(p.id)}
                      disabled={deny.isPending}
                      className="glass-button"
                      style={{
                        padding: '10px 20px',
                        borderColor: 'rgba(248,113,113,0.3)',
                        color: '#f87171', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <X size={14} /> Deny
                    </button>
                    <button
                      onClick={() => setReviseId(isRevising ? null : p.id)}
                      className="glass-button"
                      style={{
                        padding: '10px 20px',
                        borderColor: 'rgba(129,140,248,0.3)',
                        color: '#818cf8', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <RotateCcw size={14} /> Revise
                    </button>
                  </div>
                )}

                {isRevising && (
                  <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={reviseNotes}
                      onChange={(e) => setReviseNotes(e.target.value)}
                      placeholder="Revision notes..."
                      style={{
                        flex: 1, padding: '10px 16px', borderRadius: 10,
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        color: '#e2e8f0', fontSize: 13,
                        backdropFilter: 'blur(10px)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && reviseNotes.trim()) {
                          revise.mutate({ id: p.id, notes: reviseNotes })
                        }
                      }}
                    />
                    <button
                      onClick={() => revise.mutate({ id: p.id, notes: reviseNotes })}
                      disabled={!reviseNotes.trim() || revise.isPending}
                      style={{
                        padding: '10px 20px', borderRadius: 10, border: 'none',
                        background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                        color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                      }}
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
