import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, ListChecks, ArrowRight } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'

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
  active: number
}

const cardStyle = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.04)',
  borderRadius: 12,
  padding: '16px 20px',
}

const selectStyle = {
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 12,
  outline: 'none',
}

export function ListAssignments() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: lists = [], isLoading, error } = useQuery({
    queryKey: ['lead-lists'],
    queryFn: hermesClient.leads.assignments.lists,
    refetchInterval: 30_000,
  })

  const { data: stats = [] } = useQuery({
    queryKey: ['assignment-stats'],
    queryFn: hermesClient.leads.assignments.stats,
    refetchInterval: 30_000,
  })

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch(`${API}/users`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  const activeUsers = users.filter((u) => u.active)

  const reassign = useMutation({
    mutationFn: ({ listName, userId, fromUserId }: { listName: string; userId: number | null; fromUserId?: number }) =>
      hermesClient.leads.assignments.assignList(listName, userId, fromUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-lists'] })
      queryClient.invalidateQueries({ queryKey: ['assignment-stats'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    },
  })

  if (isLoading) return <div style={{ color: '#64748b' }}>Loading lists...</div>
  if (error) return <div style={{ color: '#f87171', fontSize: 13 }}>Failed to load lists: {(error as Error).message}</div>

  const totalQueued = lists.reduce((s, l) => s + l.queued, 0)
  const totalAvailable = lists.reduce((s, l) => s + l.available, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ListChecks size={18} color="#818cf8" /> List Assignments
          </h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            {totalQueued.toLocaleString()} leads queued · {totalAvailable.toLocaleString()} available to assign
          </p>
        </div>
      </div>

      {/* Per-caller summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map((s) => (
          <div key={s.user_id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Users size={14} color="#818cf8" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{s.caller_name}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#c7d2fe' }}>
              {(s.remaining ?? 0).toLocaleString()}
              <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b', marginLeft: 6 }}>in queue</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              {s.total_assigned ?? 0} assigned total · {s.contacted ?? 0} contacted · {s.interested ?? 0} interested
            </div>
          </div>
        ))}
      </div>

      {/* Lists table */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 2fr) 80px 80px 80px minmax(180px, 1.5fr) 170px',
          gap: 12,
          padding: '10px 20px',
          fontSize: 11,
          fontWeight: 600,
          color: '#64748b',
          textTransform: 'uppercase' as const,
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          <span>List</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <span style={{ textAlign: 'right' }}>Queued</span>
          <span style={{ textAlign: 'right' }}>Avail.</span>
          <span>Assigned To</span>
          <span>Reassign Queued</span>
        </div>

        {lists.map((l, i) => (
          <div key={l.list_name}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(200px, 2fr) 80px 80px 80px minmax(180px, 1.5fr) 170px',
              gap: 12,
              padding: '12px 20px',
              alignItems: 'center',
              borderBottom: i < lists.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
              background: expanded === l.list_name ? 'rgba(99,102,241,0.04)' : 'transparent',
            }}>
              <span
                onClick={() => setExpanded((p) => (p === l.list_name ? null : l.list_name))}
                title={l.list_name}
                style={{
                  fontSize: 13, color: '#e2e8f0', fontWeight: 500, cursor: 'pointer',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                }}
              >
                {l.list_name}
              </span>
              <span style={{ textAlign: 'right', fontSize: 13, color: '#94a3b8' }}>{l.total.toLocaleString()}</span>
              <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: l.queued > 0 ? '#4ade80' : '#475569' }}>
                {l.queued.toLocaleString()}
              </span>
              <span style={{ textAlign: 'right', fontSize: 13, color: '#94a3b8' }}>{l.available.toLocaleString()}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                {l.assignees.length === 0 && <span style={{ fontSize: 12, color: '#475569' }}>Unassigned</span>}
                {l.assignees.map((a) => (
                  <span key={a.user_id} style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                    background: 'rgba(99,102,241,0.12)', color: '#a5b4fc',
                  }}>
                    {a.name} · {a.count.toLocaleString()}
                  </span>
                ))}
              </span>
              <span>
                {l.queued > 0 ? (
                  <select
                    style={selectStyle}
                    value=""
                    disabled={reassign.isPending}
                    onChange={(e) => {
                      if (!e.target.value) return
                      const userId = e.target.value === 'unassign' ? null : Number(e.target.value)
                      const target = userId === null ? 'nobody (unassigned)' : activeUsers.find((u) => u.id === userId)?.display_name
                      if (confirm(`Move all ${l.queued.toLocaleString()} queued leads in "${l.list_name}" to ${target}?`)) {
                        reassign.mutate({ listName: l.list_name, userId })
                      }
                      e.target.value = ''
                    }}
                  >
                    <option value="">Move all to...</option>
                    {activeUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                    <option value="unassign">Unassigned</option>
                  </select>
                ) : (
                  <span style={{ fontSize: 11, color: '#475569' }}>—</span>
                )}
              </span>
            </div>

            {/* Expanded: per-assignee move controls */}
            {expanded === l.list_name && l.assignees.length > 0 && (
              <div style={{ padding: '4px 20px 14px 32px', borderBottom: i < lists.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                {l.assignees.map((a) => (
                  <div key={a.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 160 }}>
                      {a.name}&apos;s share ({a.count.toLocaleString()} leads)
                    </span>
                    <ArrowRight size={12} color="#475569" />
                    <select
                      style={selectStyle}
                      value=""
                      disabled={reassign.isPending}
                      onChange={(e) => {
                        if (!e.target.value) return
                        const userId = e.target.value === 'unassign' ? null : Number(e.target.value)
                        const target = userId === null ? 'nobody (unassigned)' : activeUsers.find((u) => u.id === userId)?.display_name
                        if (confirm(`Move ${a.name}'s ${a.count.toLocaleString()} queued leads in "${l.list_name}" to ${target}?`)) {
                          reassign.mutate({ listName: l.list_name, userId, fromUserId: a.user_id })
                        }
                        e.target.value = ''
                      }}
                    >
                      <option value="">Move to...</option>
                      {activeUsers.filter((u) => u.id !== a.user_id).map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))}
                      <option value="unassign">Unassigned</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {lists.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
            No lists found
          </div>
        )}
      </div>

      {reassign.error && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>
          Reassign failed: {(reassign.error as Error).message}
        </div>
      )}
    </div>
  )
}
