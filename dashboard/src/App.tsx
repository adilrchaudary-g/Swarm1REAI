import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SwarmShell } from './layouts/SwarmShell'
import { useUiStore } from './store/ui-store'
import { LeadGenApp } from './apps/lead-gen/LeadGenApp'
import { UnderwritingApp } from './apps/underwriting/UnderwritingApp'
import { KpiApp } from './apps/kpi/KpiApp'

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
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SwarmShell>
        <AppRouter />
      </SwarmShell>
    </QueryClientProvider>
  )
}
