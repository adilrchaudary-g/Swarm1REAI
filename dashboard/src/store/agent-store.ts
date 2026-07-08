import { create } from 'zustand'

interface AgentUiState {
  pendingCount: number
  setPendingCount: (n: number) => void
  notificationOpen: boolean
  toggleNotification: () => void
  closeNotification: () => void
  jarvisEnabled: boolean
  toggleJarvis: () => void
  seenProposalIds: Set<number>
  markSeen: (id: number) => void
}

export const useAgentStore = create<AgentUiState>((set) => ({
  pendingCount: 0,
  setPendingCount: (n) => set({ pendingCount: n }),
  notificationOpen: false,
  toggleNotification: () => set((s) => ({ notificationOpen: !s.notificationOpen })),
  closeNotification: () => set({ notificationOpen: false }),
  jarvisEnabled: false,
  toggleJarvis: () => set((s) => ({ jarvisEnabled: !s.jarvisEnabled })),
  seenProposalIds: new Set(),
  markSeen: (id) => set((s) => {
    const next = new Set(s.seenProposalIds)
    next.add(id)
    return { seenProposalIds: next }
  }),
}))
