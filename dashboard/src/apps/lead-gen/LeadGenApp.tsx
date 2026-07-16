import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../../store/auth-store'
import { PipelineDashboard } from './views/PipelineDashboard'
import { CallList } from './views/CallList'
import { SourcesPanel } from './views/SourcesPanel'
import { MarketSelector } from './views/MarketSelector'
import { DistressedProperties } from './views/DistressedProperties'
import { CallRecordingsPanel } from './views/CallRecordingsPanel'
import { ListAssignments } from './views/ListAssignments'
import { ContractsPanel } from '../contracts/ContractsPanel'
import type { Permission } from '../../auth/permissions'

type View = 'pipeline' | 'call-list' | 'assignments' | 'recordings' | 'contracts' | 'distressed' | 'sources' | 'markets'

const allViews: { id: View; label: string; requires: Permission }[] = [
  { id: 'pipeline', label: 'Pipeline', requires: 'view:pipeline' },
  { id: 'call-list', label: 'Call List', requires: 'view:call_list' },
  { id: 'assignments', label: 'Assignments', requires: 'action:manage_leads' },
  { id: 'recordings', label: 'Recordings', requires: 'view:recordings' },
  { id: 'contracts', label: 'Contracts', requires: 'view:contracts' },
  { id: 'distressed', label: 'Distressed', requires: 'view:distressed' },
  { id: 'sources', label: 'Sources', requires: 'view:sources' },
  { id: 'markets', label: 'Markets', requires: 'view:markets' },
]

export function LeadGenApp() {
  const { can } = useAuthStore()

  const views = useMemo(() => allViews.filter((v) => can(v.requires)), [can])
  const [view, setView] = useState<View>(views[0]?.id ?? 'call-list')

  useEffect(() => {
    if (views.length > 0 && !views.some((v) => v.id === view)) {
      setView(views[0].id)
    }
  }, [views, view])

  return (
    <div>
      <div style={{
        display: 'inline-flex',
        gap: 4,
        marginBottom: 24,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 14,
        padding: 4,
        flexWrap: 'wrap',
      }}>
        {views.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: '9px 16px',
              border: view === tab.id ? '1px solid rgba(99,102,241,0.3)' : 'none',
              borderRadius: 10,
              background: view === tab.id ? 'rgba(99,102,241,0.12)' : 'transparent',
              color: view === tab.id ? '#c7d2fe' : '#64748b',
              fontWeight: view === tab.id ? 600 : 400,
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.2s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'pipeline' && <PipelineDashboard />}
      {view === 'call-list' && <CallList />}
      {view === 'assignments' && <ListAssignments />}
      {view === 'recordings' && <CallRecordingsPanel />}
      {view === 'contracts' && <ContractsPanel />}
      {view === 'distressed' && <DistressedProperties />}
      {view === 'sources' && <SourcesPanel />}
      {view === 'markets' && <MarketSelector />}
    </div>
  )
}
