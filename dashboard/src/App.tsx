import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SwarmShell } from './layouts/SwarmShell'
import { useUiStore } from './store/ui-store'
import { useAuthStore } from './store/auth-store'
import { LoginScreen } from './components/LoginScreen'
import { LeadGenApp } from './apps/lead-gen/LeadGenApp'
import { UnderwritingApp } from './apps/underwriting/UnderwritingApp'
import { KpiApp } from './apps/kpi/KpiApp'
import { AgentsApp } from './apps/agents/AgentsApp'
import { UserManagement } from './apps/settings/UserManagement'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
})

function AppRouter() {
  const activeApp = useUiStore((s) => s.activeApp)

  switch (activeApp) {
    case 'lead-gen':
      return <LeadGenApp />
    case 'underwriting':
      return <UnderwritingApp />
    case 'kpi':
      return <KpiApp />
    case 'agents':
      return <AgentsApp />
    case 'settings':
      return <UserManagement />
  }
}

function AuthGate() {
  const { user, loading, checkSession } = useAuthStore()

  useEffect(() => {
    checkSession()
  }, [checkSession])

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: 14,
      }}>
        Loading...
      </div>
    )
  }

  if (!user) {
    return <LoginScreen />
  }

  return (
    <SwarmShell>
      <AppRouter />
    </SwarmShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  )
}
