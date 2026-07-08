import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import { AgentOverview } from './views/AgentOverview'
import { ProposalQueue } from './views/ProposalQueue'
import { RunHistory } from './views/RunHistory'
import { AgentConfig } from './views/AgentConfig'
import { Activity, Inbox, History, Settings } from 'lucide-react'

type AgentView = 'overview' | 'proposals' | 'history' | 'config'

const viewTabs: { id: AgentView; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
  { id: 'proposals', label: 'Proposals', icon: <Inbox size={14} /> },
  { id: 'history', label: 'Run History', icon: <History size={14} /> },
  { id: 'config', label: 'Config', icon: <Settings size={14} /> },
]

export function AgentsApp() {
  const [view, setView] = useState<AgentView>('overview')

  const { data: countData } = useQuery({
    queryKey: ['agent-pending-count'],
    queryFn: () => hermesClient.agents.proposals.pendingCount(),
    refetchInterval: 10_000,
  })

  return (
    <div>
      <style>{`
        @keyframes agentScan {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes agentPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(99,102,241,0.3); }
          50% { opacity: 0.7; box-shadow: 0 0 20px rgba(99,102,241,0.6); }
        }
        @keyframes agentGlow {
          0%, 100% { box-shadow: 0 0 15px rgba(99,102,241,0.1), inset 0 0 15px rgba(99,102,241,0.05); }
          50% { box-shadow: 0 0 30px rgba(99,102,241,0.2), inset 0 0 30px rgba(99,102,241,0.1); }
        }
        @keyframes borderRotate {
          0% { --angle: 0deg; }
          100% { --angle: 360deg; }
        }
        @keyframes scanLine {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.5); }
        }
        .glass-card {
          background: rgba(255,255,255,0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .glass-card:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
          transform: translateY(-1px);
        }
        .glass-card-active {
          background: rgba(99,102,241,0.06);
          border-color: rgba(99,102,241,0.2);
          box-shadow: 0 0 30px rgba(99,102,241,0.1), 0 8px 32px rgba(0,0,0,0.2);
        }
        .glass-button {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .glass-button:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.15);
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        }
        .glass-button-active {
          background: rgba(99,102,241,0.12);
          border-color: rgba(99,102,241,0.3);
          box-shadow: 0 0 20px rgba(99,102,241,0.15);
        }
        .scanning-overlay {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          overflow: hidden;
          pointer-events: none;
        }
        .scanning-overlay::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(99,102,241,0.08) 45%,
            rgba(99,102,241,0.15) 50%,
            rgba(99,102,241,0.08) 55%,
            transparent 100%
          );
          animation: scanLine 2.5s ease-in-out infinite;
        }
        .gradient-border {
          position: relative;
        }
        .gradient-border::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 17px;
          padding: 1px;
          background: linear-gradient(135deg, rgba(99,102,241,0.4), rgba(139,92,246,0.2), rgba(59,130,246,0.3), rgba(99,102,241,0.4));
          background-size: 300% 300%;
          animation: shimmer 4s linear infinite;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask-composite: xor;
          pointer-events: none;
        }
      `}</style>

      {/* Sub-nav tabs */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap',
        padding: 4, borderRadius: 14,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        backdropFilter: 'blur(10px)',
        width: 'fit-content',
      }}>
        {viewTabs.map((tab) => {
          const active = view === tab.id
          const showBadge = tab.id === 'proposals' && (countData?.count ?? 0) > 0
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={active ? 'glass-button glass-button-active' : 'glass-button'}
              style={{
                padding: '10px 18px',
                color: active ? '#c7d2fe' : '#666',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 8,
                position: 'relative',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {showBadge && (
                <span style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff', fontSize: 10, fontWeight: 700,
                  minWidth: 18, height: 18, borderRadius: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 5px',
                  boxShadow: '0 0 10px rgba(99,102,241,0.4)',
                }}>
                  {countData!.count > 99 ? '99+' : countData!.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
        {view === 'overview' && <AgentOverview />}
        {view === 'proposals' && <ProposalQueue />}
        {view === 'history' && <RunHistory />}
        {view === 'config' && <AgentConfig />}
      </div>
    </div>
  )
}
