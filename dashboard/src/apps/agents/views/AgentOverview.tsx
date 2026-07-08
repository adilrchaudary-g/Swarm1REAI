import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { AgentDefinition } from '../../../api/types'
import { Play, Square, Zap, ZapOff, Scan, Compass, Phone, Calculator, Wrench, Eye } from 'lucide-react'

const agentMeta: Record<string, { icon: React.ReactNode; gradient: string; glow: string; accent: string }> = {
  scout: {
    icon: <Compass size={20} />,
    gradient: 'linear-gradient(135deg, #6366f1, #818cf8)',
    glow: 'rgba(99,102,241,0.4)',
    accent: '#818cf8',
  },
  dispatcher: {
    icon: <Phone size={20} />,
    gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
    glow: 'rgba(139,92,246,0.4)',
    accent: '#a78bfa',
  },
  analyst: {
    icon: <Calculator size={20} />,
    gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
    glow: 'rgba(59,130,246,0.4)',
    accent: '#60a5fa',
  },
  operator: {
    icon: <Wrench size={20} />,
    gradient: 'linear-gradient(135deg, #10b981, #34d399)',
    glow: 'rgba(16,185,129,0.4)',
    accent: '#34d399',
  },
  supervisor: {
    icon: <Eye size={20} />,
    gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
    glow: 'rgba(245,158,11,0.4)',
    accent: '#fbbf24',
  },
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function AgentOverview() {
  const queryClient = useQueryClient()

  const { data: agents } = useQuery({
    queryKey: ['agent-definitions'],
    queryFn: () => hermesClient.agents.list(),
    refetchInterval: 5_000,
  })

  const { data: status } = useQuery({
    queryKey: ['agent-proxy-status'],
    queryFn: () => hermesClient.agents.proxyStatus(),
    refetchInterval: 10_000,
  })

  const { data: pendingCount } = useQuery({
    queryKey: ['agent-pending-count'],
    queryFn: () => hermesClient.agents.proposals.pendingCount(),
    refetchInterval: 10_000,
  })

  const runAgent = useMutation({
    mutationFn: (type: string) => hermesClient.agents.run(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['agent-proxy-status'] })
    },
  })

  const proxyAvailable = status?.proxy?.available ?? false

  return (
    <div>
      {/* Status banner — glass style */}
      <div
        className="glass-card"
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '16px 20px', marginBottom: 24,
          borderColor: proxyAvailable ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          background: proxyAvailable
            ? 'rgba(34,197,94,0.04)'
            : 'rgba(239,68,68,0.04)',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: proxyAvailable
            ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05))'
            : 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.05))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {proxyAvailable ? <Zap size={18} color="#22c55e" /> : <ZapOff size={18} color="#ef4444" />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: proxyAvailable ? '#86efac' : '#fca5a5' }}>
            {proxyAvailable ? 'Claude AI Online' : 'Claude AI Offline'}
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            {proxyAvailable
              ? `AI-enhanced mode active · ${status?.proxy?.total_calls ?? 0} calls processed`
              : 'Agents operating in rules-only mode'}
          </div>
        </div>
        {(pendingCount?.count ?? 0) > 0 && (
          <div style={{
            padding: '8px 16px', borderRadius: 10,
            background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#c7d2fe' }}>
              {pendingCount?.count}
            </span>
            <span style={{ fontSize: 11, color: '#6366f1', marginLeft: 6 }}>
              pending
            </span>
          </div>
        )}
      </div>

      {/* Agent cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 20,
      }}>
        {agents?.map((agent: AgentDefinition, idx: number) => {
          const meta = agentMeta[agent.agent_type] || agentMeta.lead_reviewer
          const isRunning = status?.running_agents?.[agent.agent_type] ?? false
          const enabled = !!agent.enabled

          return (
            <div
              key={agent.agent_type}
              className={`glass-card ${isRunning ? 'glass-card-active gradient-border' : ''}`}
              style={{
                padding: 0,
                opacity: enabled ? 1 : 0.4,
                position: 'relative',
                overflow: 'hidden',
                animation: `fadeIn 0.4s ease-out ${idx * 0.1}s both`,
              }}
            >
              {/* Scanning overlay when running */}
              {isRunning && <div className="scanning-overlay" />}

              {/* Ambient glow behind card when running */}
              {isRunning && (
                <div style={{
                  position: 'absolute', top: -40, right: -40,
                  width: 120, height: 120, borderRadius: '50%',
                  background: `radial-gradient(circle, ${meta.glow} 0%, transparent 70%)`,
                  animation: 'agentPulse 2s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              )}

              {/* Card header */}
              <div style={{ padding: '24px 24px 0', position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: meta.gradient,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff',
                    boxShadow: `0 4px 16px ${meta.glow}`,
                    transition: 'all 0.3s ease',
                    ...(isRunning ? { animation: 'agentPulse 2s ease-in-out infinite' } : {}),
                  }}>
                    {isRunning ? <Scan size={20} /> : meta.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', letterSpacing: '-0.01em' }}>
                      {agent.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                      {isRunning ? (
                        <span style={{ color: meta.accent }}>
                          Scanning...
                        </span>
                      ) : (
                        <>{agent.schedule} {!enabled && '· disabled'}</>
                      )}
                    </div>
                  </div>

                  {/* Status dot */}
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: 5,
                      background: isRunning ? '#22c55e' : enabled ? '#334155' : '#1e293b',
                      transition: 'all 0.3s ease',
                      ...(isRunning ? { animation: 'dotPulse 1.5s ease-in-out infinite' } : {}),
                    }} />
                    {isRunning && (
                      <div style={{
                        position: 'absolute', inset: -3, borderRadius: 8,
                        border: '2px solid rgba(34,197,94,0.3)',
                        animation: 'agentPulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                </div>

                <div style={{
                  fontSize: 12, color: '#64748b', lineHeight: 1.6,
                  marginBottom: 20,
                }}>
                  {agent.description}
                </div>
              </div>

              {/* Stats row — frosted divider */}
              <div style={{
                display: 'flex', gap: 1,
                background: 'rgba(255,255,255,0.03)',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                position: 'relative', zIndex: 1,
              }}>
                <div style={{ flex: 1, padding: '14px 20px' }}>
                  <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Last run
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
                    {timeAgo(agent.last_run_at)}
                  </div>
                </div>
                <div style={{ width: 1, background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ flex: 1, padding: '14px 20px' }}>
                  <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Status
                  </div>
                  <div style={{
                    fontSize: 13, fontWeight: 500,
                    color: agent.last_run_status === 'completed' ? '#86efac'
                      : agent.last_run_status === 'failed' ? '#fca5a5'
                      : agent.last_run_status === 'running' ? meta.accent
                      : '#475569',
                  }}>
                    {agent.last_run_status || 'never'}
                  </div>
                </div>
              </div>

              {/* Action button */}
              <div style={{ padding: '16px 24px', position: 'relative', zIndex: 1 }}>
                <button
                  onClick={() => runAgent.mutate(agent.agent_type)}
                  disabled={isRunning || !enabled || runAgent.isPending}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    borderRadius: 12,
                    border: 'none',
                    background: isRunning
                      ? 'rgba(255,255,255,0.03)'
                      : meta.gradient,
                    color: isRunning ? '#64748b' : '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: isRunning || !enabled ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    boxShadow: isRunning ? 'none' : `0 4px 20px ${meta.glow}`,
                    transition: 'all 0.3s ease',
                    letterSpacing: '0.02em',
                  }}
                  onMouseOver={(e) => {
                    if (!isRunning && enabled) {
                      e.currentTarget.style.transform = 'scale(1.02)'
                      e.currentTarget.style.boxShadow = `0 6px 28px ${meta.glow}`
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = isRunning ? 'none' : `0 4px 20px ${meta.glow}`
                  }}
                >
                  {isRunning ? (
                    <><Square size={14} /> Scanning...</>
                  ) : (
                    <><Play size={14} /> Run Agent</>
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
