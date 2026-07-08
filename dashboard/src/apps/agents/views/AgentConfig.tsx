import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { AgentDefinition } from '../../../api/types'
import { useState } from 'react'
import { Power, PowerOff, Save, Compass, Phone, Calculator, Wrench, Eye } from 'lucide-react'

const agentMeta: Record<string, { icon: React.ReactNode; gradient: string }> = {
  scout: { icon: <Compass size={18} />, gradient: 'linear-gradient(135deg, #6366f1, #818cf8)' },
  dispatcher: { icon: <Phone size={18} />, gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  analyst: { icon: <Calculator size={18} />, gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  operator: { icon: <Wrench size={18} />, gradient: 'linear-gradient(135deg, #10b981, #34d399)' },
  supervisor: { icon: <Eye size={18} />, gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
}

export function AgentConfig() {
  const queryClient = useQueryClient()

  const { data: agents } = useQuery({
    queryKey: ['agent-definitions'],
    queryFn: () => hermesClient.agents.list(),
    refetchInterval: 30_000,
  })

  const toggle = useMutation({
    mutationFn: ({ type, enabled }: { type: string; enabled: boolean }) =>
      hermesClient.agents.toggle(type, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-definitions'] }),
  })

  const updateConfig = useMutation({
    mutationFn: ({ type, config }: { type: string; config: Record<string, unknown> }) =>
      hermesClient.agents.config(type, config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-definitions'] }),
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
      gap: 20,
    }}>
      {agents?.map((agent: AgentDefinition, idx: number) => (
        <AgentConfigCard
          key={agent.agent_type}
          agent={agent}
          idx={idx}
          onToggle={(enabled) => toggle.mutate({ type: agent.agent_type, enabled })}
          onSave={(config) => updateConfig.mutate({ type: agent.agent_type, config })}
          saving={updateConfig.isPending}
        />
      ))}
    </div>
  )
}

function AgentConfigCard({
  agent, idx, onToggle, onSave, saving,
}: {
  agent: AgentDefinition
  idx: number
  onToggle: (enabled: boolean) => void
  onSave: (config: Record<string, unknown>) => void
  saving: boolean
}) {
  const [schedule, setSchedule] = useState(agent.schedule)
  const enabled = !!agent.enabled
  const dirty = schedule !== agent.schedule
  const meta = agentMeta[agent.agent_type] || agentMeta.lead_reviewer

  return (
    <div
      className="glass-card"
      style={{
        padding: 0, overflow: 'hidden',
        opacity: enabled ? 1 : 0.5,
        animation: `fadeIn 0.4s ease-out ${idx * 0.1}s both`,
      }}
    >
      {/* Header */}
      <div style={{
        padding: '24px 24px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: meta.gradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}>
            {meta.icon}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>
              {agent.display_name}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 1, fontFamily: "'SF Mono', monospace" }}>
              {agent.agent_type}
            </div>
          </div>
        </div>

        <button
          onClick={() => onToggle(!enabled)}
          className="glass-button"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', fontSize: 12, fontWeight: 600,
            borderColor: enabled ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)',
            background: enabled ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
            color: enabled ? '#4ade80' : '#f87171',
          }}
        >
          {enabled ? <Power size={14} /> : <PowerOff size={14} />}
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div style={{
        padding: '0 24px 20px',
        fontSize: 12, color: '#64748b', lineHeight: 1.6,
      }}>
        {agent.description}
      </div>

      {/* Schedule field */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(255,255,255,0.015)',
      }}>
        <label style={{
          display: 'block', fontSize: 10, color: '#475569', marginBottom: 8,
          textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
        }}>
          Schedule
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="every 4h"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: '#e2e8f0', fontSize: 13,
              backdropFilter: 'blur(10px)',
              transition: 'border-color 0.2s ease',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'rgba(99,102,241,0.3)' }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.06)' }}
          />
          {dirty && (
            <button
              onClick={() => onSave({ schedule })}
              disabled={saving}
              style={{
                padding: '10px 16px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                transition: 'all 0.2s ease',
              }}
            >
              <Save size={12} /> Save
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#334155', marginTop: 6 }}>
          "every 4h" &middot; "every 30m" &middot; "every 12h" &middot; "manual"
        </div>
      </div>

      {/* Footer meta */}
      <div style={{
        display: 'flex', gap: 1,
        borderTop: '1px solid rgba(255,255,255,0.04)',
        fontSize: 11, color: '#334155',
      }}>
        <div style={{ flex: 1, padding: '12px 24px' }}>
          Created {new Date(agent.created_at).toLocaleDateString()}
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ flex: 1, padding: '12px 24px' }}>
          Updated {new Date(agent.updated_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}
