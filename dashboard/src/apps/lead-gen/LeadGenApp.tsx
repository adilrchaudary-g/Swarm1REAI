import { useState } from 'react'
import { PipelineDashboard } from './views/PipelineDashboard'
import { CallList } from './views/CallList'
import { SourcesPanel } from './views/SourcesPanel'
import { MarketSelector } from './views/MarketSelector'

type View = 'pipeline' | 'call-list' | 'sources' | 'markets'

export function LeadGenApp() {
  const [view, setView] = useState<View>('pipeline')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {([
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'call-list', label: 'Call List' },
          { id: 'sources', label: 'Sources' },
          { id: 'markets', label: 'Markets' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: '8px 16px',
              border: '1px solid #2a2a3e',
              borderRadius: 6,
              background: view === tab.id ? '#6366f1' : '#1a1a2e',
              color: view === tab.id ? '#fff' : '#aaa',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'pipeline' && <PipelineDashboard />}
      {view === 'call-list' && <CallList />}
      {view === 'sources' && <SourcesPanel />}
      {view === 'markets' && <MarketSelector />}
    </div>
  )
}
