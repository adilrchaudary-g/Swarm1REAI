import { create } from 'zustand'

export type AppTab = 'lead-gen' | 'underwriting' | 'dispo' | 'kpi' | 'agents' | 'schedule' | 'activity' | 'finances' | 'security' | 'settings'

interface UiState {
  activeApp: AppTab
  setActiveApp: (app: AppTab) => void
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeApp: 'lead-gen',
  setActiveApp: (app) => set({ activeApp: app }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
