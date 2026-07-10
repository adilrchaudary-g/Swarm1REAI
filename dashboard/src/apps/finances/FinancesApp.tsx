import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DollarSign, TrendingUp, TrendingDown, Users, Plus, Trash2, Check, Receipt, Briefcase, CreditCard } from 'lucide-react'
import { hermesClient } from '../../api/hermes-client'
import type { Expense, Revenue, PayrollEntry } from '../../api/types'

type Section = 'overview' | 'expenses' | 'revenue' | 'payroll'

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function FinancesApp() {
  const [section, setSection] = useState<Section>('overview')

  const tabs: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <TrendingUp size={15} /> },
    { id: 'expenses', label: 'Expenses', icon: <Receipt size={15} /> },
    { id: 'revenue', label: 'Revenue', icon: <Briefcase size={15} /> },
    { id: 'payroll', label: 'Payroll', icon: <CreditCard size={15} /> },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Business Finances</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Costs, revenue, payroll, and profit tracking
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, padding: 4, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 0', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: section === t.id ? 'rgba(99,102,241,0.12)' : 'transparent',
              color: section === t.id ? '#a5b4fc' : '#64748b',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {section === 'overview' && <OverviewSection />}
      {section === 'expenses' && <ExpensesSection />}
      {section === 'revenue' && <RevenueSection />}
      {section === 'payroll' && <PayrollSection />}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────

function OverviewSection() {
  const { data: summary } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: hermesClient.finances.summary,
  })

  if (!summary) return <div style={{ color: '#64748b', fontSize: 13 }}>Loading...</div>

  const cards: { label: string; value: string; color: string; icon: React.ReactNode; sub?: string }[] = [
    {
      label: 'Monthly Overhead',
      value: fmt(summary.monthly_overhead),
      color: '#f97316',
      icon: <Receipt size={18} />,
      sub: 'Software & tools',
    },
    {
      label: 'Monthly Caller Cost',
      value: fmt(summary.monthly_caller_cost),
      color: '#eab308',
      icon: <Users size={18} />,
      sub: `${summary.active_callers} active callers`,
    },
    {
      label: 'Total Monthly Cost',
      value: fmt(summary.total_monthly_cost),
      color: '#ef4444',
      icon: <TrendingDown size={18} />,
      sub: 'Overhead + callers',
    },
    {
      label: 'Total Revenue',
      value: fmt(summary.total_revenue),
      color: '#22c55e',
      icon: <DollarSign size={18} />,
      sub: `${summary.deal_count} deals closed`,
    },
    {
      label: 'Total Payroll',
      value: fmt(summary.total_payroll),
      color: '#6366f1',
      icon: <CreditCard size={18} />,
      sub: summary.unpaid_payroll > 0 ? `${fmt(summary.unpaid_payroll)} unpaid` : 'All paid',
    },
    {
      label: 'Profit',
      value: fmt(summary.profit),
      color: summary.profit >= 0 ? '#22c55e' : '#ef4444',
      icon: <TrendingUp size={18} />,
      sub: 'Revenue minus payroll',
    },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} style={{
            padding: 18,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `${c.color}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.color,
              }}>
                {c.icon}
              </div>
              <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                {c.label}
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, fontVariantNumeric: 'tabular-nums' }}>
              {c.value}
            </div>
            {c.sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{
        padding: 20,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 12,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 14 }}>Monthly Cost Breakdown</h3>
        <CostBar label="PropStream" amount={200} total={summary.total_monthly_cost} color="#f97316" />
        <CostBar label="Twilio Autodialer" amount={30} total={summary.total_monthly_cost} color="#f97316" />
        <CostBar label={`Callers (3x ~$200/mo)`} amount={summary.monthly_caller_cost} total={summary.total_monthly_cost} color="#eab308" />
      </div>
    </div>
  )
}

function CostBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? (amount / total) * 100 : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: '#cbd5e1' }}>{label}</span>
        <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{fmt(amount)}</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

// ── Expenses ─────────────────────────────────────────────────────────

function ExpensesSection() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'software', amount: '', frequency: 'monthly', notes: '' })

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: hermesClient.finances.expenses.list,
  })

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => hermesClient.finances.expenses.save(data as Partial<Expense>),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); queryClient.invalidateQueries({ queryKey: ['finance-summary'] }); setShowAdd(false); setForm({ name: '', category: 'software', amount: '', frequency: 'monthly', notes: '' }) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => hermesClient.finances.expenses.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); queryClient.invalidateQueries({ queryKey: ['finance-summary'] }) },
  })

  const monthly = expenses.filter(e => e.active).reduce((s, e) => s + e.amount, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Recurring Expenses</span>
          <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>{fmt(monthly)}/mo</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={addBtn}>
          <Plus size={14} /> Add Expense
        </button>
      </div>

      {showAdd && (
        <div style={formCard}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 10, marginBottom: 10 }}>
            <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={input} />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={input}>
              <option value="software">Software</option>
              <option value="marketing">Marketing</option>
              <option value="phone">Phone/Dialer</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="$" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={input} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={cancelBtn}>Cancel</button>
            <button
              onClick={() => saveMutation.mutate({ name: form.name, category: form.category, amount: parseFloat(form.amount), frequency: form.frequency, notes: form.notes || undefined })}
              disabled={!form.name || !form.amount}
              style={{ ...saveBtn, opacity: !form.name || !form.amount ? 0.5 : 1 }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div style={tableContainer}>
        {expenses.map(e => (
          <div key={e.id} style={tableRow}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{e.name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{e.category} &middot; {e.frequency}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f97316', fontVariantNumeric: 'tabular-nums', marginRight: 12 }}>
              {fmt(e.amount)}
            </div>
            <button onClick={() => { if (confirm(`Delete ${e.name}?`)) deleteMutation.mutate(e.id) }} style={deleteBtn}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Revenue ──────────────────────────────────────────────────────────

function RevenueSection() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ deal_address: '', assignment_fee: '', caller_user_id: '', closed_at: '', notes: '' })

  const { data: deals = [] } = useQuery({
    queryKey: ['revenue'],
    queryFn: hermesClient.finances.revenue.list,
  })

  const { data: users = [] } = useQuery<Array<{ id: number; display_name: string; role: string; active: number }>>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${localStorage.getItem('swarm_token') || ''}` } })
      return res.ok ? res.json() : []
    },
  })

  const callers = users.filter(u => u.role === 'caller')

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => hermesClient.finances.revenue.add(data as Partial<Revenue>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revenue'] })
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] })
      setShowAdd(false)
      setForm({ deal_address: '', assignment_fee: '', caller_user_id: '', closed_at: '', notes: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => hermesClient.finances.revenue.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['revenue'] }); queryClient.invalidateQueries({ queryKey: ['finance-summary'] }) },
  })

  const totalRevenue = deals.reduce((s, d) => s + d.assignment_fee, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Closed Deals</span>
          <span style={{ fontSize: 12, color: '#22c55e', marginLeft: 8 }}>{fmt(totalRevenue)} total</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={addBtn}>
          <Plus size={14} /> Log Deal
        </button>
      </div>

      {showAdd && (
        <div style={formCard}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr 130px', gap: 10, marginBottom: 10 }}>
            <input placeholder="Property address" value={form.deal_address} onChange={e => setForm(f => ({ ...f, deal_address: e.target.value }))} style={input} />
            <input placeholder="Fee $" type="number" value={form.assignment_fee} onChange={e => setForm(f => ({ ...f, assignment_fee: e.target.value }))} style={input} />
            <select value={form.caller_user_id} onChange={e => setForm(f => ({ ...f, caller_user_id: e.target.value }))} style={input}>
              <option value="">Caller (optional)</option>
              {callers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
            <input type="date" value={form.closed_at} onChange={e => setForm(f => ({ ...f, closed_at: e.target.value }))} style={input} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={cancelBtn}>Cancel</button>
            <button
              onClick={() => saveMutation.mutate({
                deal_address: form.deal_address, assignment_fee: parseFloat(form.assignment_fee),
                caller_user_id: form.caller_user_id ? parseInt(form.caller_user_id) : undefined,
                closed_at: form.closed_at || new Date().toISOString().slice(0, 10),
                notes: form.notes || undefined,
              })}
              disabled={!form.assignment_fee}
              style={{ ...saveBtn, opacity: !form.assignment_fee ? 0.5 : 1 }}
            >
              Save Deal
            </button>
          </div>
        </div>
      )}

      {deals.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
          No deals logged yet. When you close a deal, log it here to track revenue and commissions.
        </div>
      ) : (
        <div style={tableContainer}>
          {deals.map(d => (
            <div key={d.id} style={tableRow}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{d.deal_address || 'Untitled Deal'}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Closed {d.closed_at?.slice(0, 10)}
                  {d.caller_name && <> &middot; Set by <span style={{ color: '#a5b4fc' }}>{d.caller_name}</span></>}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e', fontVariantNumeric: 'tabular-nums', marginRight: 12 }}>
                {fmt(d.assignment_fee)}
              </div>
              <button onClick={() => { if (confirm('Delete this deal?')) deleteMutation.mutate(d.id) }} style={deleteBtn}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Payroll ──────────────────────────────────────────────────────────

function PayrollSection() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ user_id: '', week_start: '', week_end: '', hours_worked: '', hourly_rate: '2', commission: '0' })

  const { data: payroll = [] } = useQuery({
    queryKey: ['payroll'],
    queryFn: () => hermesClient.finances.payroll.list(),
  })

  const { data: users = [] } = useQuery<Array<{ id: number; display_name: string; role: string; active: number }>>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${localStorage.getItem('swarm_token') || ''}` } })
      return res.ok ? res.json() : []
    },
  })

  const callers = users.filter(u => u.role === 'caller')

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => hermesClient.finances.payroll.save(data as Partial<PayrollEntry>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] })
      setShowAdd(false)
      setForm({ user_id: '', week_start: '', week_end: '', hours_worked: '', hourly_rate: '2', commission: '0' })
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: (id: number) => hermesClient.finances.payroll.markPaid(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll'] }); queryClient.invalidateQueries({ queryKey: ['finance-summary'] }) },
  })

  const unpaid = payroll.filter(p => !p.paid)
  const totalUnpaid = unpaid.reduce((s, p) => s + p.total_pay, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Payroll</span>
          {totalUnpaid > 0 && (
            <span style={{ fontSize: 12, color: '#eab308', marginLeft: 8 }}>{fmt(totalUnpaid)} unpaid</span>
          )}
        </div>
        <button onClick={() => setShowAdd(true)} style={addBtn}>
          <Plus size={14} /> Add Week
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        Payouts every Friday &middot; $2/hr base + 5% commission on closed deals
      </div>

      {showAdd && (
        <div style={formCard}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px 80px', gap: 10, marginBottom: 10 }}>
            <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} style={input}>
              <option value="">Select caller</option>
              {callers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
            <input type="date" placeholder="Week start" value={form.week_start} onChange={e => setForm(f => ({ ...f, week_start: e.target.value }))} style={input} />
            <input type="date" placeholder="Week end" value={form.week_end} onChange={e => setForm(f => ({ ...f, week_end: e.target.value }))} style={input} />
            <input placeholder="Hours" type="number" value={form.hours_worked} onChange={e => setForm(f => ({ ...f, hours_worked: e.target.value }))} style={input} />
            <input placeholder="Comm $" type="number" value={form.commission} onChange={e => setForm(f => ({ ...f, commission: e.target.value }))} style={input} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={cancelBtn}>Cancel</button>
            <button
              onClick={() => saveMutation.mutate({
                user_id: parseInt(form.user_id),
                week_start: form.week_start, week_end: form.week_end,
                hours_worked: parseFloat(form.hours_worked || '0'),
                hourly_rate: parseFloat(form.hourly_rate),
                commission: parseFloat(form.commission || '0'),
              })}
              disabled={!form.user_id || !form.week_start}
              style={{ ...saveBtn, opacity: !form.user_id || !form.week_start ? 0.5 : 1 }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {payroll.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
          No payroll entries yet. Add weekly hours for each caller to track pay.
        </div>
      ) : (
        <div style={tableContainer}>
          {payroll.map(p => (
            <div key={p.id} style={{ ...tableRow, borderLeft: `3px solid ${p.paid ? '#22c55e' : '#eab308'}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{p.caller_name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: p.paid ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                    color: p.paid ? '#4ade80' : '#eab308',
                  }}>
                    {p.paid ? 'PAID' : 'UNPAID'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                  {p.week_start} → {p.week_end} &middot; {p.hours_worked}h @ ${p.hourly_rate}/hr
                  {p.commission > 0 && <> + {fmt(p.commission)} comm</>}
                </div>
              </div>
              <div style={{ textAlign: 'right', marginRight: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#6366f1', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(p.total_pay)}
                </div>
                <div style={{ fontSize: 10, color: '#475569' }}>
                  base {fmt(p.base_pay)}
                </div>
              </div>
              {!p.paid && (
                <button
                  onClick={() => markPaidMutation.mutate(p.id)}
                  title="Mark as paid"
                  style={{
                    padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'rgba(34,197,94,0.08)', color: '#4ade80', fontSize: 11, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Check size={12} /> Pay
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared Styles ────────────────────────────────────────────────────

const addBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', border: 'none', borderRadius: 8,
  background: 'rgba(99,102,241,0.12)', color: '#a5b4fc',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const formCard: React.CSSProperties = {
  padding: 16,
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(99,102,241,0.2)',
  borderRadius: 12,
  marginBottom: 16,
}

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: '#e2e8f0', fontSize: 12,
  outline: 'none',
}

const cancelBtn: React.CSSProperties = {
  padding: '7px 14px', border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6, background: 'transparent', color: '#94a3b8',
  fontSize: 12, cursor: 'pointer',
}

const saveBtn: React.CSSProperties = {
  padding: '7px 14px', border: 'none', borderRadius: 6,
  background: 'rgba(99,102,241,0.9)', color: '#fff',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const tableContainer: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.04)',
  borderRadius: 12,
  overflow: 'hidden',
}

const tableRow: React.CSSProperties = {
  padding: '14px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  display: 'flex', alignItems: 'center', gap: 12,
}

const deleteBtn: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'rgba(239,68,68,0.05)', color: '#64748b',
}
