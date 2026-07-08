import { useState } from 'react'
import { DealQueue } from './views/DealQueue'
import { DealReport } from './views/DealReport'
import { OfferCalculator } from './views/OfferCalculator'

type View = 'queue' | 'report' | 'calculator'

const viewTabs: { id: View; label: string }[] = [
  { id: 'queue', label: 'Deal Queue' },
  { id: 'report', label: 'Report' },
  { id: 'calculator', label: 'Offer Calculator' },
]

export function UnderwritingApp() {
  const [view, setView] = useState<View>('queue')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
      }}>
        {viewTabs.map((tab) => (
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

      {view === 'queue' && (
        <DealQueue onViewReport={(id) => { setSelectedId(id); setView('report') }} />
      )}
      {view === 'report' && selectedId && (
        <DealReport leadId={selectedId} onBack={() => setView('queue')} />
      )}
      {view === 'report' && !selectedId && (
        <div style={{
          padding: 32, border: '1px dashed #2a2a3e', borderRadius: 14,
          textAlign: 'center', color: '#334155',
        }}>
          <p>No deal selected.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Select a deal from the Deal Queue to view its underwriting report.
          </p>
          <button
            onClick={() => setView('queue')}
            style={{
              marginTop: 12, padding: '7px 16px', borderRadius: 4, border: 'none',
              background: '#6366f118', color: '#818cf8', fontSize: 12,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Go to Deal Queue
          </button>
        </div>
      )}
      {view === 'calculator' && <OfferCalculator />}
    </div>
  )
}
