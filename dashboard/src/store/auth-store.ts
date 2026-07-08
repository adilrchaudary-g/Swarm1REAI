import { create } from 'zustand'
import type { Role, Permission } from '../auth/permissions'
import { hasPermission } from '../auth/permissions'

export interface AuthUser {
  id: number
  username: string
  display_name: string
  role: Role
  permissions_json: string
  active: number
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
  error: string | null

  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
  can: (perm: Permission) => boolean
  isAdmin: () => boolean
}

const API = '/api'

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('swarm_token'),
  loading: true,
  error: null,

  login: async (username, password) => {
    set({ error: null, loading: true })
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Login failed' }))
        set({ error: data.error || 'Login failed', loading: false })
        return false
      }
      const data = await res.json()
      localStorage.setItem('swarm_token', data.token)
      set({ user: data.user, token: data.token, loading: false, error: null })
      return true
    } catch {
      set({ error: 'Connection failed', loading: false })
      return false
    }
  },

  logout: async () => {
    const { token } = get()
    if (token) {
      fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
    localStorage.removeItem('swarm_token')
    set({ user: null, token: null, error: null })
  },

  checkSession: async () => {
    const { token } = get()
    if (!token) {
      set({ loading: false })
      return
    }
    try {
      const res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const user = await res.json()
        set({ user, loading: false })
      } else {
        localStorage.removeItem('swarm_token')
        set({ user: null, token: null, loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  can: (perm) => {
    const { user } = get()
    if (!user) return false
    const perms: string[] = JSON.parse(user.permissions_json || '[]')
    return hasPermission(perms, perm)
  },

  isAdmin: () => {
    const { user } = get()
    return user?.role === 'admin'
  },
}))
