import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUiStore, type AppTab } from '../store/ui-store'
import { useAgentStore } from '../store/agent-store'
import { useAuthStore } from '../store/auth-store'
import { hermesClient } from '../api/hermes-client'
import { Radio, ClipboardList, BarChart3, Bot, Bell, Menu, X, Check, XIcon, Eye, LogOut, User, Settings, Calendar, DollarSign, FileText, Handshake, Shield } from 'lucide-react'
import { JarvisOverlay } from '../components/JarvisOverlay'
import type { Proposal } from '../api/types'
import type { Permission } from '../auth/permissions'

const allTabs: { id: AppTab; label: string; icon: React.ReactNode; requires: Permission; adminOnly?: boolean }[] = [
  { id: 'lead-gen', label: 'Lead Gen', icon: <Radio size={18} />, requires: 'view:call_list' },
  { id: 'underwriting', label: 'Underwriting', icon: <ClipboardList size={18} />, requires: 'view:underwriting' },
  { id: 'dispo', label: 'Dispo', icon: <Handshake size={18} />, requires: 'view:dispo' },
  { id: 'kpi', label: 'KPI & Follow-Up', icon: <BarChart3 size={18} />, requires: 'view:kpi' },
  { id: 'agents', label: 'Agents', icon: <Bot size={18} />, requires: 'view:agents' },
  { id: 'schedule', label: 'Schedule', icon: <Calendar size={18} />, requires: 'view:schedule' },
  { id: 'activity', label: 'Daily Log', icon: <FileText size={18} />, requires: 'view:activity' },
  { id: 'finances', label: 'Finances', icon: <DollarSign size={18} />, requires: 'view:finances' },
  { id: 'security', label: 'SABSA', icon: <Shield size={18} />, requires: 'view:security', adminOnly: true },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} />, requires: 'action:manage_users' },
]

const INFORMATIONAL_ACTIONS = new Set([
  'create_follow_up', 'daily_digest', 'transcribe_recording',
  'grade_recording', 'add_note',
])

function isProposalInformational(p: Proposal): boolean {
  try {
    const payload = typeof p.payload_json === 'string' ? JSON.parse(p.payload_json) : p.payload_json
    return INFORMATIONAL_ACTIONS.has(payload?.action)
  } catch { return false }
}

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

function NotificationBell() {
  const { pendingCount, setPendingCount, notificationOpen, toggleNotification, closeNotification } = useAgentStore()
  const { setActiveApp } = useUiStore()
  const queryClient = useQueryClient()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: countData } = useQuery({
    queryKey: ['agent-pending-count'],
    queryFn: () => hermesClient.agents.proposals.pendingCount(),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (countData) setPendingCount(countData.count)
  }, [countData, setPendingCount])

  const { data: pendingProposals } = useQuery({
    queryKey: ['agent-pending-proposals'],
    queryFn: () => hermesClient.agents.proposals.list({ status: 'pending', limit: 5 }),
    refetchInterval: 15_000,
    enabled: notificationOpen,
  })

  const approve = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-pending-count'] })
      queryClient.invalidateQueries({ queryKey: ['agent-pending-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['agent-proposals'] })
    },
  })

  const deny = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.deny(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-pending-count'] })
      queryClient.invalidateQueries({ queryKey: ['agent-pending-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['agent-proposals'] })
    },
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeNotification()
      }
    }
    if (notificationOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [notificationOpen, closeNotification])

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={toggleNotification}
        style={{
          background: pendingCount > 0 ? 'rgba(99,102,241,0.08)' : 'none',
          border: pendingCount > 0 ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
          borderRadius: 10, cursor: 'pointer',
          color: pendingCount > 0 ? '#c7d2fe' : '#475569',
          padding: 8, position: 'relative', display: 'flex', alignItems: 'center',
          transition: 'all 0.2s ease',
        }}
      >
        <Bell size={17} />
        {pendingCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontSize: 9, fontWeight: 700,
            minWidth: 17, height: 17, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
            boxShadow: '0 0 10px rgba(99,102,241,0.5)',
          }}>
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {notificationOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 10,
          width: 380, maxHeight: 420, overflow: 'auto',
          background: 'rgba(15,15,25,0.9)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
              Proposals
              <span style={{
                marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#818cf8',
                background: 'rgba(99,102,241,0.12)', padding: '2px 8px', borderRadius: 6,
              }}>
                {pendingCount}
              </span>
            </span>
            <button
              onClick={() => { closeNotification(); setActiveApp('agents') }}
              style={{
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: 8, color: '#818cf8',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '5px 12px',
                transition: 'all 0.2s ease',
              }}
            >
              View all
            </button>
          </div>

          {(!pendingProposals || pendingProposals.length === 0) && (
            <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
              No pending proposals
            </div>
          )}

          {pendingProposals?.map((p: Proposal) => {
            const isInfo = isProposalInformational(p)
            return (
              <div key={p.id} style={{
                padding: '14px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 0.15s ease',
              }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                      {p.agent_type.replace(/_/g, ' ')}
                      <span style={{ margin: '0 5px', color: '#1e293b' }}>&middot;</span>
                      <span style={{
                        color: p.priority === 'high' ? '#fb923c' : p.priority === 'critical' ? '#f87171' : '#64748b',
                      }}>
                        {p.priority}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {isInfo ? (
                      <button
                        onClick={() => approve.mutate(p.id)}
                        disabled={approve.isPending}
                        style={{
                          background: 'rgba(99,102,241,0.08)',
                          border: '1px solid rgba(99,102,241,0.2)',
                          borderRadius: 8, color: '#a5b4fc', cursor: 'pointer',
                          padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                        title="Acknowledge"
                      >
                        <Check size={12} /> Okay
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => approve.mutate(p.id)}
                          disabled={approve.isPending}
                          style={{
                            background: 'rgba(74,222,128,0.08)',
                            border: '1px solid rgba(74,222,128,0.2)',
                            borderRadius: 8, color: '#4ade80', cursor: 'pointer',
                            padding: '6px 8px', display: 'flex', alignItems: 'center',
                            transition: 'all 0.15s ease',
                          }}
                          title="Approve"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => deny.mutate(p.id)}
                          disabled={deny.isPending}
                          style={{
                            background: 'rgba(248,113,113,0.08)',
                            border: '1px solid rgba(248,113,113,0.2)',
                            borderRadius: 8, color: '#f87171', cursor: 'pointer',
                            padding: '6px 8px', display: 'flex', alignItems: 'center',
                            transition: 'all 0.15s ease',
                          }}
                          title="Deny"
                        >
                          <XIcon size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function JarvisToggle() {
  const { jarvisEnabled, toggleJarvis } = useAgentStore()
  return (
    <div style={{
      padding: '12px 20px',
      borderTop: '1px solid rgba(255,255,255,0.04)',
    }}>
      <button
        onClick={toggleJarvis}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px 12px', borderRadius: 10,
          background: jarvisEnabled ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${jarvisEnabled ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)'}`,
          color: jarvisEnabled ? '#fbbf24' : '#475569',
          fontSize: 12, fontWeight: 500, cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
      >
        <Eye size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>SWARM AI</span>
        <div style={{
          width: 32, height: 16, borderRadius: 8, position: 'relative',
          background: jarvisEnabled ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.08)',
          transition: 'background 0.2s ease',
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: 6, position: 'absolute', top: 2,
            left: jarvisEnabled ? 18 : 2,
            background: jarvisEnabled ? '#fbbf24' : '#475569',
            boxShadow: jarvisEnabled ? '0 0 8px rgba(245,158,11,0.5)' : 'none',
            transition: 'all 0.2s ease',
          }} />
        </div>
      </button>
    </div>
  )
}

export function SwarmShell({ children }: { children: React.ReactNode }) {
  const { activeApp, setActiveApp } = useUiStore()
  const { user, logout, can } = useAuthStore()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const tabs = allTabs.filter((tab) => can(tab.requires) && (!tab.adminOnly || user?.role === 'admin'))

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeApp)) {
      setActiveApp(tabs[0].id)
    }
  }, [tabs, activeApp, setActiveApp])

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false)
  }, [isMobile])

  function handleTabClick(id: AppTab) {
    setActiveApp(id)
    if (isMobile) setDrawerOpen(false)
  }

  const sidebar = (
    <nav style={{
      width: 230,
      minWidth: 230,
      background: 'rgba(10,10,18,0.8)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      padding: '24px 0',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{
        padding: '0 24px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <h1 style={{
            fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            SWARM
          </h1>
          <span style={{ fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase' }}>
            Wholesale Ops
          </span>
        </div>
        {isMobile && (
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, marginTop: -2 }}
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div style={{ padding: '0 12px' }}>
        {tabs.map((tab) => {
          const active = activeApp === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '11px 14px',
                marginBottom: 2,
                border: 'none',
                borderRadius: 10,
                background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: active ? '#c7d2fe' : '#64748b',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                boxShadow: active ? '0 0 20px rgba(99,102,241,0.08)' : 'none',
              }}
              onMouseOver={(e) => {
                if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }}
              onMouseOut={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{
                opacity: active ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {active && (
                <div style={{
                  marginLeft: 'auto', width: 4, height: 4, borderRadius: 2,
                  background: '#6366f1',
                  boxShadow: '0 0 8px rgba(99,102,241,0.6)',
                }} />
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* JARVIS toggle — admin only */}
      {user?.role === 'admin' && <JarvisToggle />}

      {/* User menu */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: user?.role === 'admin'
              ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
              : 'linear-gradient(135deg, #22c55e, #16a34a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <User size={14} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#e2e8f0',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {user?.display_name || user?.username}
            </div>
            <div style={{
              fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {user?.role}
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            style={{
              background: 'none', border: 'none', color: '#475569',
              cursor: 'pointer', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </nav>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Desktop sidebar */}
      {!isMobile && sidebar}

      {/* JARVIS overlay */}
      <JarvisOverlay />

      {/* Mobile drawer overlay */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              animation: 'slideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
        padding: isMobile ? '16px 12px' : '24px 28px',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 20, paddingBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          {isMobile && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="glass-button"
              style={{
                color: '#94a3b8', padding: '8px 10px',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Menu size={20} />
            </button>
          )}
          <div style={{ flex: 1 }}>
            {isMobile && (
              <>
                <span style={{
                  fontSize: 15, fontWeight: 800,
                  background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>SWARM</span>
                <span style={{ fontSize: 10, color: '#475569', marginLeft: 10, letterSpacing: 2 }}>
                  {tabs.find((t) => t.id === activeApp)?.label.toUpperCase()}
                </span>
              </>
            )}
            {!isMobile && (
              <span style={{ fontSize: 12, color: '#475569', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 500 }}>
                {tabs.find((t) => t.id === activeApp)?.label}
              </span>
            )}
          </div>
          <Clock />
          <NotificationBell />
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </main>
    </div>
  )
}

// Always-visible real-time clock in US Eastern (12-hour), so the caller always
// knows the time regardless of their machine's timezone.
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
  return (
    <div
      title="Current Eastern time"
      style={{
        display: 'flex', alignItems: 'baseline', gap: 4,
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: 0.5 }}>{time}</span>
      <span style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>ET</span>
    </div>
  )
}
