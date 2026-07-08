import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../api/hermes-client'
import { useAgentStore } from '../store/agent-store'
import type { Proposal } from '../api/types'
import { X, Eye, Check, XIcon } from 'lucide-react'

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: '#64748b', width: 70, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.04)' }}>
        <div style={{
          height: '100%', borderRadius: 3, background: color,
          width: `${pct}%`, transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8', width: 40, fontWeight: 600 }}>{value.toLocaleString()}</span>
    </div>
  )
}

export function JarvisOverlay() {
  const { jarvisEnabled, seenProposalIds, markSeen } = useAgentStore()
  const [visible, setVisible] = useState(false)
  const [currentProposal, setCurrentProposal] = useState<Proposal | null>(null)
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()

  const { data: proposals } = useQuery({
    queryKey: ['jarvis-proposals'],
    queryFn: () => hermesClient.agents.proposals.list({ status: 'pending', agent_type: 'supervisor', limit: 5 }),
    refetchInterval: 15_000,
    enabled: jarvisEnabled,
  })

  useEffect(() => {
    if (!jarvisEnabled || !proposals) return

    const unseen = proposals.filter((p) => !seenProposalIds.has(p.id))
    if (unseen.length > 0 && !visible) {
      const proposal = unseen[0]
      setCurrentProposal(proposal)
      markSeen(proposal.id)
      setVisible(true)

      const timer = setTimeout(() => setVisible(false), 30_000)
      setDismissTimer(timer)
    }
  }, [proposals, jarvisEnabled, seenProposalIds, visible, markSeen])

  const approve = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jarvis-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['agent-pending-count'] })
      setVisible(false)
    },
  })

  const deny = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.deny(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jarvis-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['agent-pending-count'] })
      setVisible(false)
    },
  })

  function dismiss() {
    if (dismissTimer) clearTimeout(dismissTimer)
    setVisible(false)
  }

  if (!jarvisEnabled || !visible || !currentProposal) return null

  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(currentProposal.payload_json) } catch {}

  const displayType = (payload.display_type as string) || 'insight'
  const content = (payload.content as string) || currentProposal.description || ''
  const data = payload.data as Record<string, unknown> | undefined
  const funnel = data?.funnel as Record<string, number> | undefined

  const haloColors: Record<string, string> = {
    digest: '#6366f1',
    alert: '#ef4444',
    insight: '#8b5cf6',
    funnel: '#3b82f6',
    source_report: '#10b981',
    agent_status: '#f59e0b',
  }
  const haloColor = haloColors[displayType] || '#6366f1'

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 420, maxHeight: 500,
      zIndex: 2000,
      animation: 'jarvisSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <style>{`
        @keyframes jarvisSlideIn {
          from { opacity: 0; transform: translateX(40px) translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
        }
        @keyframes jarvisGlow {
          0%, 100% { box-shadow: 0 0 20px ${haloColor}30, 0 0 60px ${haloColor}10, 0 20px 60px rgba(0,0,0,0.5); }
          50% { box-shadow: 0 0 30px ${haloColor}40, 0 0 80px ${haloColor}15, 0 20px 60px rgba(0,0,0,0.5); }
        }
        @keyframes jarvisBorderGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Gradient border wrapper */}
      <div style={{
        position: 'relative',
        borderRadius: 20,
        padding: 1,
        background: `linear-gradient(135deg, ${haloColor}60, ${haloColor}20, ${haloColor}40, ${haloColor}10, ${haloColor}60)`,
        backgroundSize: '300% 300%',
        animation: 'jarvisBorderGlow 4s ease infinite, jarvisGlow 3s ease-in-out infinite',
      }}>
        <div style={{
          background: 'rgba(10,10,20,0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 19,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `linear-gradient(135deg, ${haloColor}, ${haloColor}80)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 12px ${haloColor}50`,
            }}>
              <Eye size={14} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em' }}>
                SWARM AI
              </span>
              <span style={{
                fontSize: 9, color: haloColor, marginLeft: 8,
                textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
              }}>
                {displayType}
              </span>
            </div>
            <button
              onClick={dismiss}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: 6,
                display: 'flex', alignItems: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Title */}
          <div style={{ padding: '14px 18px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.4 }}>
              {currentProposal.title}
            </div>
          </div>

          {/* Content */}
          <div style={{
            padding: '10px 18px',
            fontSize: 12, color: '#94a3b8', lineHeight: 1.7,
            maxHeight: 200, overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {content}
          </div>

          {/* Funnel visualization */}
          {funnel && (
            <div style={{ padding: '4px 18px 14px' }}>
              <div style={{
                fontSize: 9, color: '#475569', marginBottom: 8,
                textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
              }}>
                Pipeline
              </div>
              {(() => {
                const max = Math.max(...Object.values(funnel), 1)
                const colors = ['#6366f1', '#818cf8', '#a78bfa', '#8b5cf6', '#3b82f6', '#22c55e']
                return Object.entries(funnel).map(([k, v], i) => (
                  <FunnelBar key={k} label={k} value={v} max={max} color={colors[i % colors.length]} />
                ))
              })()}
            </div>
          )}

          {/* Actions */}
          {currentProposal.status === 'pending' && (
            <div style={{
              display: 'flex', gap: 8, padding: '12px 18px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
            }}>
              <button
                onClick={() => approve.mutate(currentProposal.id)}
                disabled={approve.isPending}
                style={{
                  flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: `linear-gradient(135deg, ${haloColor}, ${haloColor}cc)`,
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  boxShadow: `0 4px 16px ${haloColor}40`,
                  transition: 'all 0.2s ease',
                }}
              >
                <Check size={14} /> Approve
              </button>
              <button
                onClick={() => deny.mutate(currentProposal.id)}
                disabled={deny.isPending}
                className="glass-button"
                style={{
                  padding: '10px 16px',
                  borderColor: 'rgba(248,113,113,0.2)',
                  color: '#f87171', fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <XIcon size={14} /> Deny
              </button>
              <button
                onClick={dismiss}
                className="glass-button"
                style={{
                  padding: '10px 16px',
                  color: '#64748b', fontSize: 12,
                }}
              >
                Later
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
