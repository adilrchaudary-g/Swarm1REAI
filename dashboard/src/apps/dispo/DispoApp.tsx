import { useState } from 'react'
import { CountyOverview } from './views/CountyOverview'
import { DealMatcher } from './views/DealMatcher'
import { BuyerDirectory } from './views/BuyerDirectory'

type View = 'overview' | 'matcher' | 'directory'

const views: { id: View; label: string }[] = [
  { id: 'overview', label: 'County Overview' },
  { id: 'matcher', label: 'Deal Matcher' },
  { id: 'directory', label: 'Buyer Directory' },
]

export function DispoApp() {
  const [view, setView] = useState<View>('overview')

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

      {view === 'overview' && <CountyOverview />}
      {view === 'matcher' && <DealMatcher />}
      {view === 'directory' && <BuyerDirectory />}
    </div>
  )
}
