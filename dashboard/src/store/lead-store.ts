import { create } from 'zustand'
import type { Lead } from '../api/types'

interface LeadState {
  activeLead: Lead | null
  setActiveLead: (lead: Lead | null) => void
  filters: LeadFilters
  setFilters: (filters: Partial<LeadFilters>) => void
}

interface LeadFilters {
  status: string | null
  tier: string | null
  source: string | null
  persona: string | null
}

export const useLeadStore = create<LeadState>((set) => ({
  activeLead: null,
  setActiveLead: (lead) => set({ activeLead: lead }),
  filters: { status: null, tier: null, source: null, persona: null },
  setFilters: (partial) =>
    set((s) => ({ filters: { ...s.filters, ...partial } })),
}))
