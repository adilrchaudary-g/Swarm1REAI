import { useState, useEffect } from 'react'
import { useUiStore, type AppTab } from '../store/ui-store'
import { Radio, ClipboardList, BarChart3, Menu, X } from 'lucide-react'

const tabs: { id: AppTab; label: string; icon: React.ReactNode }[] = [
  { id: 'lead-gen', label: 'Lead Gen', icon: <Radio size={18} /> },
  { id: 'underwriting', label: 'Underwriting', icon: <ClipboardList size={18} /> },
  { id: 'kpi', label: 'KPI & Follow-Up', icon: <BarChart3 size={18} /> },
]

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

export function SwarmShell({ children }: { children: React.ReactNode }) {
  const { activeApp, setActiveApp } = useUiStore()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false)
  }, [isMobile])

  function handleTabClick(id: AppTab) {
    setActiveApp(id)
    if (isMobile) setDrawerOpen(false)
  }

  const sidebar = (
    <nav style={{
      width: 220,
      minWidth: 220,
      background: '#111118',
      borderRight: '1px solid #1e1e2e',
      padding: '20px 0',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{
        padding: '0 20px 24px',
        borderBottom: '1px solid #1e1e2e',
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', margin: 0 }}>
            SWARM
          </h1>
          <span style={{ fontSize: 11, color: '#666', letterSpacing: 1 }}>
            WHOLESALE OPS
          </span>
        </div>
        {isMobile && (
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4, marginTop: -2 }}
          >
            <X size={20} />
          </button>
        )}
      </div>

      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id)}
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
          {tab.icon}
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
  )

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0f', overflow: 'hidden' }}>
      {/* Desktop sidebar */}
      {!isMobile && sidebar}

      {/* Mobile drawer overlay */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.6)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              animation: 'slideIn 0.2s ease-out',
            }}
          >
            {sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? '16px 12px' : 24,
        minWidth: 0,
      }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 16, paddingBottom: 12,
            borderBottom: '1px solid #1e1e2e',
          }}>
            <button
              onClick={() => setDrawerOpen(true)}
              style={{
                background: '#111118', border: '1px solid #2a2a3e', borderRadius: 8,
                color: '#ccc', cursor: 'pointer', padding: '8px 10px',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Menu size={20} />
            </button>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#e0e0e0' }}>SWARM</span>
              <span style={{ fontSize: 10, color: '#555', marginLeft: 8, letterSpacing: 1 }}>
                {tabs.find((t) => t.id === activeApp)?.label.toUpperCase()}
              </span>
            </div>
          </div>
        )}
        {children}
      </main>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
