import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import { ChatPanel } from './views/ChatPanel'
import { ProposalQueue } from './views/ProposalQueue'
import { RunHistory } from './views/RunHistory'
import { MessageSquare, Inbox, History, Settings } from 'lucide-react'

type AgentView = 'chat' | 'proposals' | 'history' | 'system'

const viewTabs: { id: AgentView; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
  { id: 'proposals', label: 'Proposals', icon: <Inbox size={14} /> },
  { id: 'history', label: 'History', icon: <History size={14} /> },
]

export function AgentsApp() {
  const [view, setView] = useState<AgentView>('chat')

  const { data: countData } = useQuery({
    queryKey: ['agent-pending-count'],
    queryFn: () => hermesClient.agents.proposals.pendingCount(),
    refetchInterval: 10_000,
  })

  return (
    <div>
      {/* Sub-nav tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        padding: 4, borderRadius: 12,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        width: 'fit-content',
      }}>
        {viewTabs.map((tab) => {
          const active = view === tab.id
          const showBadge = tab.id === 'proposals' && (countData?.count ?? 0) > 0
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: 8,
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: active ? '#c7d2fe' : '#64748b',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {showBadge && (
                <span style={{
                  background: '#6366f1',
                  color: '#fff', fontSize: 10, fontWeight: 700,
                  minWidth: 18, height: 18, borderRadius: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 5px',
                }}>
                  {countData!.count > 99 ? '99+' : countData!.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {view === 'chat' && <ChatPanel />}
      {view === 'proposals' && <ProposalQueue />}
      {view === 'history' && <RunHistory />}
    </div>
  )
}
