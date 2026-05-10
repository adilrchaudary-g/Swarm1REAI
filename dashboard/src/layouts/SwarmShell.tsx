import { useUiStore, type AppTab } from '../store/ui-store'

const tabs: { id: AppTab; label: string; icon: string }[] = [
  { id: 'lead-gen', label: 'Lead Gen', icon: '📡' },
  { id: 'underwriting', label: 'Underwriting', icon: '📋' },
  { id: 'kpi', label: 'KPI & Follow-Up', icon: '📊' },
]

export function SwarmShell({ children }: { children: React.ReactNode }) {
  const { activeApp, setActiveApp } = useUiStore()

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0f' }}>
      <nav style={{
        width: 220,
        background: '#111118',
        borderRight: '1px solid #1e1e2e',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '0 20px 24px',
          borderBottom: '1px solid #1e1e2e',
          marginBottom: 16,
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', margin: 0 }}>
            SWARM
          </h1>
          <span style={{ fontSize: 11, color: '#666', letterSpacing: 1 }}>
            WHOLESALE OPS
          </span>
        </div>

        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveApp(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 20px',
              border: 'none',
              background: activeApp === tab.id ? '#1a1a2e' : 'transparent',
              color: activeApp === tab.id ? '#fff' : '#888',
              fontSize: 14,
              cursor: 'pointer',
              textAlign: 'left',
              borderLeft: activeApp === tab.id ? '3px solid #6366f1' : '3px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid #1e1e2e',
          fontSize: 11,
          color: '#444',
        }}>
          v0.1.0
        </div>
      </nav>

      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: 24,
      }}>
        {children}
      </main>
    </div>
  )
}
