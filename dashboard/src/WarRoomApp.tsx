import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WarRoom from './apps/command-center/WarRoom'
import './war-room.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
})

export default function WarRoomApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <WarRoom />
    </QueryClientProvider>
  )
}
