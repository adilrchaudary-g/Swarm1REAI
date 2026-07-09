import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, Shield, Phone } from 'lucide-react'
import { CALLER_PERMISSIONS, type Permission } from '../../auth/permissions'

const API = '/api'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('swarm_token')
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

interface UserRecord {
  id: number
  username: string
  display_name: string
  role: string
  permissions_json: string
  active: number
  created_at: string
}

const ALL_PERMISSIONS: { perm: Permission; label: string; group: string }[] = [
  { perm: 'view:call_list', label: 'View Call List', group: 'Views' },
  { perm: 'view:dial_mode', label: 'Dial Mode', group: 'Views' },
  { perm: 'view:recordings', label: 'Recordings', group: 'Views' },
  { perm: 'view:own_kpi', label: 'Own KPIs', group: 'Views' },
  { perm: 'view:pipeline', label: 'Pipeline', group: 'Views' },
  { perm: 'view:contracts', label: 'Contracts', group: 'Views' },
  { perm: 'view:distressed', label: 'Distressed', group: 'Views' },
  { perm: 'view:sources', label: 'Sources', group: 'Views' },
  { perm: 'view:markets', label: 'Markets', group: 'Views' },
  { perm: 'view:schedule', label: 'Schedule', group: 'Views' },
  { perm: 'view:activity', label: 'Activity', group: 'Views' },
  { perm: 'view:finances', label: 'Finances', group: 'Views' },
  { perm: 'view:underwriting', label: 'Underwriting', group: 'Views' },
  { perm: 'view:kpi', label: 'Full KPIs', group: 'Views' },
  { perm: 'view:agents', label: 'Agents', group: 'Views' },
  { perm: 'action:log_call', label: 'Log Calls', group: 'Actions' },
  { perm: 'action:add_note', label: 'Add Notes', group: 'Actions' },
  { perm: 'action:upload_recording', label: 'Upload Recordings', group: 'Actions' },
  { perm: 'action:manage_leads', label: 'Manage Leads', group: 'Actions' },
  { perm: 'action:manage_users', label: 'Manage Users', group: 'Actions' },
]

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
}

export function UserManagement() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', display_name: '', password: '', role: 'caller' })
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(CALLER_PERMISSIONS))

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch(`${API}/users`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  const createUser = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ...newUser,
          permissions: Array.from(selectedPerms),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create user')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreate(false)
      setNewUser({ username: '', display_name: '', password: '', role: 'caller' })
      setSelectedPerms(new Set(CALLER_PERMISSIONS))
    },
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await fetch(`${API}/users/${id}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ active }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const deleteUser = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${API}/users/${id}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ _delete: true }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const togglePerm = (perm: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev)
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return next
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Team Members</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Manage caller accounts and permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            background: 'rgba(99,102,241,0.9)',
            border: 'none', borderRadius: 8,
            color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <UserPlus size={14} /> Add Caller
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          padding: 20,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 12,
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#c7d2fe', marginBottom: 16 }}>
            New Caller Account
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Username</label>
              <input
                value={newUser.username}
                onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
                placeholder="e.g. caller1"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Display Name</label>
              <input
                value={newUser.display_name}
                onChange={(e) => setNewUser((u) => ({ ...u, display_name: e.target.value }))}
                placeholder="e.g. John"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Role</label>
              <select
                value={newUser.role}
                onChange={(e) => {
                  const role = e.target.value
                  setNewUser((u) => ({ ...u, role }))
                  if (role === 'caller') setSelectedPerms(new Set(CALLER_PERMISSIONS))
                  if (role === 'admin') setSelectedPerms(new Set(['*']))
                }}
                style={{ ...inputStyle, appearance: 'none' as const }}
              >
                <option value="caller">Caller</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {newUser.role === 'caller' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
                Permissions
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ALL_PERMISSIONS.map(({ perm, label }) => {
                  const active = selectedPerms.has(perm)
                  return (
                    <button
                      key={perm}
                      onClick={() => togglePerm(perm)}
                      style={{
                        padding: '5px 10px',
                        fontSize: 11,
                        fontWeight: 500,
                        borderRadius: 6,
                        border: `1px solid ${active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}`,
                        background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                        color: active ? '#c7d2fe' : '#64748b',
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowCreate(false)}
              style={{
                padding: '8px 16px', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8, background: 'transparent', color: '#94a3b8',
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => createUser.mutate()}
              disabled={!newUser.username || !newUser.password || createUser.isPending}
              style={{
                padding: '8px 16px', border: 'none', borderRadius: 8,
                background: 'rgba(99,102,241,0.9)', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                opacity: !newUser.username || !newUser.password ? 0.5 : 1,
              }}
            >
              {createUser.isPending ? 'Creating...' : 'Create Account'}
            </button>
          </div>

          {createUser.error && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>
              {(createUser.error as Error).message}
            </div>
          )}
        </div>
      )}

      {/* User list */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {users.map((u, i) => {
          const perms: string[] = JSON.parse(u.permissions_json || '[]')
          const isAdmin = u.role === 'admin'
          return (
            <div
              key={u.id}
              style={{
                padding: '14px 20px',
                borderBottom: i < users.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                display: 'flex', alignItems: 'center', gap: 14,
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: isAdmin
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                  : u.active ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#334155',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isAdmin ? <Shield size={16} color="#fff" /> : <Phone size={16} color="#fff" />}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                    {u.display_name}
                  </span>
                  <span style={{ fontSize: 11, color: '#475569' }}>@{u.username}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                    background: isAdmin ? 'rgba(99,102,241,0.12)' : 'rgba(34,197,94,0.1)',
                    color: isAdmin ? '#a5b4fc' : '#4ade80',
                  }}>
                    {u.role}
                  </span>
                  {!u.active && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: 'rgba(239,68,68,0.1)', color: '#f87171',
                    }}>
                      DISABLED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  {isAdmin ? 'Full access' : perms.length + ' permissions'}
                </div>
              </div>

              {!isAdmin && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                    title={u.active ? 'Disable account' : 'Enable account'}
                    style={{
                      padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: 'none', cursor: 'pointer',
                      background: u.active ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                      color: u.active ? '#f87171' : '#4ade80',
                    }}
                  >
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${u.display_name}?`)) deleteUser.mutate(u.id)
                    }}
                    title="Delete"
                    style={{
                      padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,0.05)', color: '#64748b',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {users.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
            No users yet
          </div>
        )}
      </div>
    </div>
  )
}
