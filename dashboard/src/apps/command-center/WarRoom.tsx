// @ts-nocheck
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  Crosshair, Phone, BarChart3, FileText, Radio, Eye, EyeOff, Settings,
  Flame, PhoneCall, PhoneOff, PhoneMissed,
  DollarSign, Star, Clock, X, Check, AlertTriangle,
  TrendingUp, Zap, Target, Layers,
  SkipForward, Undo2, CalendarDays, ExternalLink,
  Activity, Shield, Volume2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie,
} from 'recharts'
import { Toaster, toast } from 'sonner'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import confetti from 'canvas-confetti'

import { hermesClient } from '../../api/hermes-client'
import type { Lead, PipelineStats, KpiSummary, UnderwritingReport, CallRecording, Proposal } from '../../api/types'
import { useAgentStore } from '../../store/agent-store'

import ParticleField from './components/ParticleField'
import AnimatedCounter from './components/AnimatedCounter'
import JarvisOrb from './components/JarvisOrb'

type AppView = 'command' | 'calls' | 'dial' | 'kpi' | 'underwriting' | 'agents'

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toLocaleString()}`

const fmtCounter = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : n.toLocaleString()

const tierClass = (t: string | null | undefined) => {
  const tier = (t || '').toUpperCase()
  if (tier === 'HOT') return 'hot'
  if (tier === 'WARM' || tier === 'LUKEWARM') return 'warm'
  if (tier === 'COLD') return 'cold'
  return 'dead'
}

const gradeClass = (g: string | null | undefined) =>
  (g || 'f').toLowerCase().charAt(0) as 'a' | 'b' | 'c' | 'd' | 'f'

const INFORMATIONAL_ACTIONS = new Set([
  'create_follow_up', 'daily_digest', 'transcribe_recording',
  'grade_recording', 'add_note',
])

function isInformational(p: Proposal): boolean {
  try {
    const payload = typeof p.payload_json === 'string' ? JSON.parse(p.payload_json) : p.payload_json
    return INFORMATIONAL_ACTIONS.has(payload?.action)
  } catch { return false }
}

function proposalDescription(p: Proposal): string {
  if (p.description) return p.description
  try {
    const payload = typeof p.payload_json === 'string' ? JSON.parse(p.payload_json) : p.payload_json
    return payload?.description || payload?.summary || payload?.reason || ''
  } catch { return '' }
}

const panelVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
}

const chartColors = {
  accent: 'oklch(0.68 0.22 275)',
  accentDim: 'oklch(0.45 0.15 275)',
  warm: 'oklch(0.78 0.16 85)',
  green: 'oklch(0.72 0.19 155)',
  hot: 'oklch(0.68 0.24 28)',
  cyan: 'oklch(0.76 0.11 210)',
  surface: 'oklch(0.14 0.02 270)',
  gridLine: 'oklch(0.20 0.02 270 / 0.4)',
  text: 'oklch(0.52 0.015 270)',
}

// ═══════════════════════════════════════════════════
// MAIN SHELL
// ═══════════════════════════════════════════════════
export default function WarRoom() {
  const [view, setView] = useState<AppView>('command')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const { jarvisEnabled, toggleJarvis, pendingCount, setPendingCount } = useAgentStore()

  const { data: proposals } = useQuery({
    queryKey: ['agent-pending-proposals'],
    queryFn: () => hermesClient.agents.proposals.list({ status: 'pending', limit: 20 }),
    refetchInterval: 8_000,
  })

  useEffect(() => {
    if (proposals) setPendingCount(proposals.length)
  }, [proposals, setPendingCount])

  const navItems: { id: AppView; icon: typeof Crosshair; label: string; badge?: boolean }[] = [
    { id: 'command', icon: Crosshair, label: 'Command' },
    { id: 'calls', icon: Phone, label: 'Calls' },
    { id: 'kpi', icon: BarChart3, label: 'KPI' },
    { id: 'underwriting', icon: FileText, label: 'Deals' },
    { id: 'agents', icon: Radio, label: 'Agents', badge: pendingCount > 0 },
  ]

  return (
    <div className="war-room">
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'oklch(0.14 0.02 270 / 0.9)',
            border: '1px solid oklch(0.28 0.03 270 / 0.5)',
            color: 'oklch(0.93 0.008 270)',
            fontFamily: 'var(--wr-font-sans)',
            backdropFilter: 'blur(16px)',
          },
        }}
      />
      <ParticleField />

      {/* ── Sidebar ── */}
      <nav className="wr-sidebar">
        <motion.div
          className="wr-sidebar-logo"
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
        >
          S
        </motion.div>

        {navItems.map((n, i) => (
          <motion.button
            key={n.id}
            className={`wr-nav-btn ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
            title={n.label}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
          >
            <n.icon size={19} strokeWidth={1.8} />
            {n.badge && <span className="wr-nav-badge" />}
          </motion.button>
        ))}

        <div className="wr-nav-spacer" />

        <motion.button
          className={`wr-nav-btn ${jarvisEnabled ? 'active' : ''}`}
          onClick={toggleJarvis}
          title={jarvisEnabled ? 'JARVIS On' : 'JARVIS Off'}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
        >
          {jarvisEnabled ? <Eye size={19} strokeWidth={1.8} /> : <EyeOff size={19} strokeWidth={1.8} />}
        </motion.button>
      </nav>

      {/* ── Main ── */}
      <div className="wr-main">
        <TopBar view={view} />
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            className="wr-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'command' && <CommandView onSelectLead={setSelectedLead} selectedLead={selectedLead} onNavigate={setView} />}
            {view === 'calls' && <CallListView selectedLead={selectedLead} onSelectLead={setSelectedLead} onDial={() => setView('dial')} />}
            {view === 'dial' && <DialView onBack={() => setView('calls')} />}
            {view === 'kpi' && <KpiView />}
            {view === 'underwriting' && <UnderwritingView />}
            {view === 'agents' && <AgentsView />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── JARVIS ── */}
      {jarvisEnabled && <JarvisOrb proposals={proposals || []} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════
function TopBar({ view }: { view: AppView }) {
  const { data: kpi } = useQuery({
    queryKey: ['kpi-summary'],
    queryFn: () => hermesClient.kpi.summary(),
    refetchInterval: 30_000,
  })

  const labels: Record<AppView, string> = {
    command: 'Command Center',
    calls: 'Call List',
    dial: 'Dial Mode',
    kpi: 'Performance',
    underwriting: 'Deal Analysis',
    agents: 'Agent Fleet',
  }

  return (
    <motion.div className="wr-topbar" initial={{ y: -44 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}>
      <span className="wr-topbar-title">{labels[view]}</span>
      <div className="wr-topbar-spacer" />
      {kpi && (
        <>
          <div className="wr-topbar-stat">
            <span className="label">Pipeline</span>
            <span className="value">{fmt(kpi.pipeline_value)}</span>
          </div>
          <div className="wr-topbar-stat">
            <span className="label">Leads</span>
            <span className="value">{kpi.total_leads?.toLocaleString()}</span>
          </div>
          <div className="wr-topbar-stat">
            <span className="label">F/U</span>
            <span className="value" style={{ color: (kpi.follow_ups_due || 0) > 0 ? 'var(--wr-warm)' : undefined }}>
              {kpi.follow_ups_due}
            </span>
          </div>
        </>
      )}
      <div className="wr-live-indicator">
        <div className="wr-live-dot" />
        <span>Live</span>
      </div>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════
// COMMAND CENTER
// ═══════════════════════════════════════════════════
function CommandView({ onSelectLead, selectedLead, onNavigate }: {
  onSelectLead: (l: Lead | null) => void; selectedLead: Lead | null; onNavigate: (v: AppView) => void
}) {
  const { data: stats } = useQuery({ queryKey: ['pipeline-stats'], queryFn: () => hermesClient.pipeline.stats(), refetchInterval: 15_000 })
  const { data: kpi } = useQuery({ queryKey: ['kpi-summary'], queryFn: () => hermesClient.kpi.summary(), refetchInterval: 30_000 })
  const { data: hotLeads } = useQuery({ queryKey: ['queue-hot'], queryFn: () => hermesClient.queue.hot(), refetchInterval: 15_000 })
  const { data: funnel } = useQuery({ queryKey: ['kpi-funnel'], queryFn: () => hermesClient.kpi.funnel() })
  const { data: daily } = useQuery({ queryKey: ['kpi-daily', 14], queryFn: () => hermesClient.kpi.daily(14) })
  const { data: recordings } = useQuery({ queryKey: ['call-recordings'], queryFn: () => hermesClient.callRecordings.list(8) })
  const { data: sourceRoi } = useQuery({ queryKey: ['source-roi'], queryFn: () => hermesClient.kpi.sourceRoi() })

  const metrics = useMemo(() => {
    if (!kpi || !stats) return []
    const byStatus = stats.by_status || {}
    const byTier = stats.by_tier || {}
    return [
      { label: 'Total Leads', value: kpi.total_leads || 0, color: '' },
      { label: 'Hot Leads', value: byTier['HOT'] || 0, color: 'hot' },
      { label: 'Queued', value: byStatus['queued'] || 0, color: 'accent' },
      { label: 'Interested', value: byStatus['interested'] || 0, color: 'warm' },
      { label: 'Pipeline', value: kpi.pipeline_value || 0, color: 'green', prefix: '$', formatFn: fmtCounter },
      { label: 'Closed', value: kpi.deals_closed || 0, color: 'green' },
    ]
  }, [kpi, stats])

  const funnelData = useMemo(() => {
    if (!funnel) return []
    const stages = ['imported', 'enriched', 'queued', 'contacted', 'interested', 'under_contract', 'closed_won']
    const max = Math.max(1, ...stages.map(s => (funnel as Record<string, number>)[s] || 0))
    return stages.map(s => ({
      name: s.replace(/_/g, ' '),
      value: (funnel as Record<string, number>)[s] || 0,
      pct: ((funnel as Record<string, number>)[s] || 0) / max * 100,
    }))
  }, [funnel])

  const chartData = useMemo(() => {
    if (!daily || !Array.isArray(daily)) return []
    return daily.map((d: { date: string; calls: number; interested: number }) => ({
      day: new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      calls: d.calls || 0,
      interested: d.interested || 0,
    }))
  }, [daily])

  const isLoading = !kpi || !stats

  return (
    <div className="wr-command-grid">
      {/* ── Metrics ── */}
      <div className="wr-metrics-row">
        {isLoading ? Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="wr-metric">
            <Skeleton baseColor="oklch(0.16 0.02 270)" highlightColor="oklch(0.22 0.025 270)" width={60} height={8} />
            <Skeleton baseColor="oklch(0.16 0.02 270)" highlightColor="oklch(0.22 0.025 270)" width={80} height={28} />
          </div>
        )) : metrics.map((m, i) => (
          <motion.div
            key={m.label}
            className="wr-metric"
            custom={i}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            whileHover={{ y: -3, transition: { duration: 0.2 } }}
          >
            <span className="wr-metric-label">{m.label}</span>
            <AnimatedCounter
              value={m.value}
              prefix={m.prefix || ''}
              className={`wr-metric-value ${m.color}`}
              formatFn={m.formatFn}
            />
          </motion.div>
        ))}
      </div>

      {/* ── Hot Queue ── */}
      <motion.div className="wr-glow-panel hot" custom={1} variants={panelVariants} initial="hidden" animate="visible">
        <div className="wr-panel-header">
          <Flame size={14} style={{ color: 'var(--wr-hot)' }} />
          <span className="wr-panel-title">Hot Queue</span>
          <span className="wr-panel-count">{hotLeads?.length || 0}</span>
          <motion.button
            className="wr-btn sm primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => onNavigate('calls')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Zap size={12} /> Dial
          </motion.button>
        </div>
        <div className="wr-panel-body" style={{ padding: 0 }}>
          <AnimatePresence>
            {(hotLeads || []).slice(0, 15).map((lead: Lead, i: number) => (
              <motion.div
                key={lead.lead_id}
                className={`wr-lead-row ${selectedLead?.lead_id === lead.lead_id ? 'selected' : ''}`}
                onClick={() => onSelectLead(lead)}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03, duration: 0.3 }}
                whileHover={{ x: 4 }}
              >
                <span className={`wr-dot ${tierClass(lead.motivation_tier)}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wr-text)' }}>{lead.property_street || 'Unknown'}</div>
                  <div style={{ fontSize: 10, color: 'var(--wr-text-ghost)' }}>{lead.owner_first} {lead.owner_last}</div>
                </div>
                <div style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 10, color: 'var(--wr-text-ghost)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className={`wr-tier ${tierClass(lead.motivation_tier)}`}>
                    {(lead.motivation_tier || '?').slice(0, 3)}
                  </span>
                  {lead.arv_estimate && <span>{fmt(lead.arv_estimate)}</span>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {(!hotLeads || hotLeads.length === 0) && (
            <div className="wr-empty"><Target size={24} /><span>No hot leads in queue</span></div>
          )}
        </div>
      </motion.div>

      {/* ── Pipeline + Chart ── */}
      <motion.div className="wr-glow-panel accent" custom={2} variants={panelVariants} initial="hidden" animate="visible">
        <div className="wr-panel-header">
          <TrendingUp size={14} style={{ color: 'var(--wr-accent)' }} />
          <span className="wr-panel-title">Pipeline</span>
        </div>
        <div className="wr-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Funnel */}
          <div>
            {funnelData.map((s, i) => (
              <motion.div
                key={s.name}
                className="wr-funnel-stage"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
              >
                <span className="wr-funnel-label">{s.name}</span>
                <div className="wr-funnel-bar-track">
                  <motion.div
                    className="wr-funnel-bar-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${s.pct}%` }}
                    transition={{ delay: i * 0.05 + 0.2, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
                  />
                </div>
                <span className="wr-funnel-count">{s.value}</span>
              </motion.div>
            ))}
          </div>

          {/* Daily Activity Chart */}
          {chartData.length > 0 && (
            <div>
              <span className="wr-panel-title" style={{ display: 'block', marginBottom: 10 }}>14-Day Activity</span>
              <div className="wr-chart-wrap" style={{ height: 140 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData} barGap={2}>
                    <XAxis
                      dataKey="day"
                      tick={{ fill: chartColors.text, fontSize: 9, fontFamily: 'var(--wr-font-mono)' }}
                      axisLine={{ stroke: chartColors.gridLine }}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.14 0.02 270 / 0.95)',
                        border: '1px solid oklch(0.28 0.03 270 / 0.5)',
                        borderRadius: 8,
                        fontFamily: 'var(--wr-font-mono)',
                        fontSize: 11,
                        color: 'oklch(0.93 0.008 270)',
                        backdropFilter: 'blur(12px)',
                      }}
                    />
                    <Bar dataKey="calls" fill={chartColors.accent} radius={[3, 3, 0, 0]} opacity={0.5} />
                    <Bar dataKey="interested" fill={chartColors.warm} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Recent Calls ── */}
      <motion.div className="wr-glow-panel" custom={3} variants={panelVariants} initial="hidden" animate="visible">
        <div className="wr-panel-header">
          <PhoneCall size={14} style={{ color: 'var(--wr-cyan)' }} />
          <span className="wr-panel-title">Recent Calls</span>
        </div>
        <div className="wr-panel-body" style={{ padding: 0 }}>
          {(recordings || []).slice(0, 8).map((r: CallRecording, i: number) => (
            <motion.div
              key={r.id}
              className="wr-lead-row"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
            >
              <span className={`wr-dot ${r.call_score != null && r.call_score >= 7 ? 'interested' : r.call_score != null && r.call_score >= 4 ? 'contacted' : 'dead'}`} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wr-text)' }}>{r.seller_name || 'Unknown'}</div>
                <div style={{ fontSize: 10, color: 'var(--wr-text-ghost)' }}>
                  {r.property_address || '—'} · {r.duration_seconds ? `${Math.floor(r.duration_seconds / 60)}:${String(r.duration_seconds % 60).padStart(2, '0')}` : '—'}
                </div>
              </div>
              {r.call_score != null && (
                <span className={`wr-tier ${r.call_score >= 7 ? 'warm' : r.call_score >= 4 ? 'cold' : 'dead'}`}>
                  {r.call_score}/10
                </span>
              )}
            </motion.div>
          ))}
          {(!recordings || recordings.length === 0) && (
            <div className="wr-empty"><Volume2 size={20} /><span>No recordings</span></div>
          )}
        </div>
      </motion.div>

      {/* ── Source Performance ── */}
      <motion.div className="wr-glow-panel green" custom={4} variants={panelVariants} initial="hidden" animate="visible">
        <div className="wr-panel-header">
          <Layers size={14} style={{ color: 'var(--wr-green)' }} />
          <span className="wr-panel-title">Source Performance</span>
        </div>
        <div className="wr-panel-body" style={{ padding: 0 }}>
          <table className="wr-table">
            <thead>
              <tr><th>Source</th><th>Total</th><th>Queued</th><th>Interested</th><th>Won</th></tr>
            </thead>
            <tbody>
              {(sourceRoi || []).map((s: { source: string; total: number; queued: number; interested: number; won: number }, i: number) => (
                <motion.tr
                  key={s.source}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <td className="bright">{s.source || 'Unknown'}</td>
                  <td className="mono">{s.total}</td>
                  <td className="mono">{s.queued}</td>
                  <td className="mono" style={{ color: s.interested > 0 ? 'var(--wr-warm)' : undefined }}>{s.interested}</td>
                  <td className="mono" style={{ color: s.won > 0 ? 'var(--wr-green)' : undefined }}>{s.won}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {(!sourceRoi || sourceRoi.length === 0) && (
            <div className="wr-empty"><Layers size={20} /><span>No source data</span></div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// CALL LIST
// ═══════════════════════════════════════════════════
function CallListView({ selectedLead, onSelectLead, onDial }: {
  selectedLead: Lead | null; onSelectLead: (l: Lead | null) => void; onDial: () => void
}) {
  const [statusFilter, setStatusFilter] = useState('queued')
  const qc = useQueryClient()

  const { data: leads, isLoading } = useQuery({
    queryKey: ['leads-list', statusFilter],
    queryFn: () => hermesClient.leads.list({ status: statusFilter !== 'all' ? statusFilter : undefined, limit: 200 }),
    refetchInterval: 20_000,
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => hermesClient.leads.updateStatus(id, status),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['leads-list'] })
      qc.invalidateQueries({ queryKey: ['pipeline-stats'] })
      toast.success(`Lead moved to ${vars.status}`)
    },
  })

  const filters = ['all', 'queued', 'contacted', 'interested', 'follow_up', 'underwriting', 'new']

  return (
    <div className="wr-calllist-layout">
      <div className="wr-calllist-main">
        <div className="wr-calllist-toolbar">
          <div className="wr-tabs">
            {filters.map(f => (
              <button key={f} className={`wr-tab ${statusFilter === f ? 'active' : ''}`} onClick={() => setStatusFilter(f)}>
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <motion.button className="wr-btn primary" onClick={onDial} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Zap size={14} /> Dial Mode
          </motion.button>
        </div>

        <div className="wr-calllist-table-wrap">
          {isLoading ? (
            <div style={{ padding: 16 }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} baseColor="oklch(0.14 0.02 270)" highlightColor="oklch(0.20 0.025 270)" height={38} style={{ marginBottom: 2, borderRadius: 4 }} />
              ))}
            </div>
          ) : (
            <table className="wr-table">
              <thead>
                <tr><th style={{ width: 30 }}>#</th><th>Address</th><th>Owner</th><th>Tier</th><th>ARV</th><th>Phone</th><th>Source</th></tr>
              </thead>
              <tbody>
                {(leads || []).map((lead: Lead, i: number) => (
                  <motion.tr
                    key={lead.lead_id}
                    className={selectedLead?.lead_id === lead.lead_id ? 'selected' : ''}
                    onClick={() => onSelectLead(lead)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.5) }}
                    whileHover={{ backgroundColor: 'oklch(0.18 0.02 270 / 0.5)' }}
                  >
                    <td className="mono" style={{ color: 'var(--wr-text-ghost)' }}>{i + 1}</td>
                    <td className="bright">{lead.property_street || '—'}</td>
                    <td>{lead.owner_first} {lead.owner_last}</td>
                    <td><span className={`wr-tier ${tierClass(lead.motivation_tier)}`}>{(lead.motivation_tier || '—').slice(0, 3)}</span></td>
                    <td className="mono">{lead.arv_estimate ? fmt(lead.arv_estimate) : '—'}</td>
                    <td className="mono">{lead.callable_phones?.[0]?.number || '—'}</td>
                    <td style={{ color: 'var(--wr-text-ghost)' }}>{lead.source || '—'}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
          {!isLoading && (!leads || leads.length === 0) && (
            <div className="wr-empty"><Target size={24} /><span>No leads matching filter</span></div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedLead && (
          <motion.div
            className="wr-detail"
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
          >
            <div className="wr-detail-section" style={{ borderBottom: '1px solid oklch(0.22 0.02 270 / 0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{selectedLead.property_street}</div>
                  <div style={{ fontSize: 11, color: 'var(--wr-text-ghost)' }}>
                    {selectedLead.property_city}, {selectedLead.property_state} {selectedLead.property_zip}
                  </div>
                </div>
                <motion.button className="wr-btn sm" onClick={() => onSelectLead(null)} whileTap={{ scale: 0.9 }}><X size={12} /></motion.button>
              </div>
            </div>

            <div className="wr-detail-section">
              <div className="wr-detail-section-title">Owner</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{selectedLead.owner_first} {selectedLead.owner_last}</div>
            </div>

            <div className="wr-detail-section">
              <div className="wr-detail-section-title">Valuation</div>
              <div className="wr-detail-row"><span className="wr-detail-key">ARV</span><span className="wr-detail-val">{fmt(selectedLead.arv_estimate)}</span></div>
              <div className="wr-detail-row"><span className="wr-detail-key">MAO (70%)</span><span className="wr-detail-val">{fmt(selectedLead.mao)}</span></div>
              <div className="wr-detail-row">
                <span className="wr-detail-key">Score</span>
                <span className={`wr-tier ${tierClass(selectedLead.motivation_tier)}`}>{selectedLead.motivation_tier || '—'} ({selectedLead.motivation_score ?? '—'})</span>
              </div>
            </div>

            {selectedLead.distress_signals && selectedLead.distress_signals.length > 0 && (
              <div className="wr-detail-section">
                <div className="wr-detail-section-title">Distress Signals</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedLead.distress_signals.map((s, i) => (
                    <motion.span key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                      style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 9, padding: '3px 8px', background: 'oklch(0.68 0.24 28 / 0.08)', color: 'var(--wr-hot)', borderRadius: 4, letterSpacing: 0.3 }}>
                      {s}
                    </motion.span>
                  ))}
                </div>
              </div>
            )}

            <div className="wr-detail-section">
              <div className="wr-detail-section-title">Contact</div>
              {(selectedLead.callable_phones || []).map((p, i) => (
                <div key={i} className="wr-detail-row">
                  <span className="wr-detail-key">{p.type || 'Phone'}</span>
                  <a href={`tel:${p.number}`} className="wr-detail-val" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>{p.number}</a>
                </div>
              ))}
            </div>

            <div className="wr-detail-section" style={{ borderBottom: 'none' }}>
              <div className="wr-detail-section-title">Actions</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { status: 'interested', label: 'Interested', icon: Star, cls: 'success' },
                  { status: 'follow_up', label: 'Follow Up', icon: Clock, cls: '' },
                  { status: 'not_interested', label: 'Dead', icon: X, cls: 'danger' },
                  { status: 'underwriting', label: 'Underwrite', icon: FileText, cls: 'primary' },
                ].map(a => (
                  <motion.button key={a.status} className={`wr-btn sm ${a.cls}`}
                    onClick={() => updateStatus.mutate({ id: selectedLead.lead_id, status: a.status })}
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}>
                    <a.icon size={11} /> {a.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// DIAL MODE
// ═══════════════════════════════════════════════════
function DialView({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient()
  const { data: queue } = useQuery({ queryKey: ['queue-all'], queryFn: () => hermesClient.queue.all() })
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'answered' | 'no_answer' | 'interested'>('idle')
  const [note, setNote] = useState('')
  const [fuDate, setFuDate] = useState('')
  const [lastBadIdx, setLastBadIdx] = useState<number | null>(null)

  const lead = queue?.[idx] as Lead | undefined
  const total = queue?.length || 0
  const phone = lead?.callable_phones?.[0]?.number || '—'

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => hermesClient.leads.updateStatus(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue-all'] }); qc.invalidateQueries({ queryKey: ['pipeline-stats'] }) },
  })

  const advance = useCallback(() => { setPhase('idle'); setNote(''); setFuDate(''); setIdx(p => Math.min(p + 1, total - 1)) }, [total])

  const handleDisposition = useCallback((status: string) => {
    if (!lead) return
    if (status === 'bad_number') setLastBadIdx(idx)
    updateStatus.mutate({ id: lead.lead_id, status: status === 'bad_number' ? 'dead' : status })
    if (note) hermesClient.leads.addNote(lead.lead_id, note, 'seller_call').catch(() => {})
    if (fuDate) hermesClient.followUps.create({ lead_id: lead.lead_id, scheduled_date: fuDate, notes: note || 'Follow up', follow_up_type: 'call' }).catch(() => {})
    if (status === 'interested') {
      toast.success('Lead marked interested!')
      confetti({ particleCount: 60, spread: 50, origin: { y: 0.7 }, colors: ['#a78bfa', '#c084fc', '#e879f9'] })
    }
    advance()
  }, [lead, idx, note, fuDate, advance, updateStatus])

  if (!queue || queue.length === 0) {
    return (
      <motion.div className="wr-dial-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="wr-dial-card" style={{ textAlign: 'center', alignItems: 'center' }}>
          <Target size={56} style={{ color: 'var(--wr-text-ghost)' }} />
          <div style={{ fontSize: 18, color: 'var(--wr-text-secondary)', fontWeight: 500 }}>Queue empty</div>
          <motion.button className="wr-btn primary" onClick={onBack} whileHover={{ scale: 1.05 }}>Back to Calls</motion.button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div className="wr-dial-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <ParticleField />
      {/* Progress */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 10 }}>
        <motion.button className="wr-btn sm" onClick={onBack} whileTap={{ scale: 0.9 }}><X size={12} /> Exit</motion.button>
        <div className="wr-progress" style={{ flex: 1 }}>
          <div className="wr-progress-fill" style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
        <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 12, color: 'var(--wr-text-ghost)', fontWeight: 700 }}>
          {idx + 1} / {total}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          className="wr-dial-card"
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.98 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          style={{ zIndex: 10 }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>{lead?.property_street || 'Unknown'}</div>
            <div style={{ fontSize: 12, color: 'var(--wr-text-ghost)', marginTop: 4 }}>
              {lead?.property_city}, {lead?.property_state} · {lead?.owner_first} {lead?.owner_last}
            </div>
          </div>

          <a href={`tel:${phone}`} className="wr-dial-phone">{phone}</a>

          <div className="wr-grid-4">
            {[
              { label: 'Tier', val: <span className={`wr-tier ${tierClass(lead?.motivation_tier)}`}>{lead?.motivation_tier || '—'}</span> },
              { label: 'ARV', val: <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 14, fontWeight: 700 }}>{fmt(lead?.arv_estimate)}</span> },
              { label: 'MAO', val: <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 14, fontWeight: 700 }}>{fmt(lead?.mao)}</span> },
              { label: 'Source', val: <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 11, color: 'var(--wr-text-secondary)' }}>{lead?.source || '—'}</span> },
            ].map(m => (
              <div key={m.label} className="wr-metric"><span className="wr-metric-label">{m.label}</span>{m.val}</div>
            ))}
          </div>

          {phase === 'idle' && (
            <motion.div className="wr-dial-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <motion.button className="wr-dial-btn green" onClick={() => setPhase('answered')} whileHover={{ y: -4 }} whileTap={{ scale: 0.96 }}>
                <PhoneCall size={18} />Answered
              </motion.button>
              <motion.button className="wr-dial-btn red" onClick={() => setPhase('no_answer')} whileHover={{ y: -4 }} whileTap={{ scale: 0.96 }}>
                <PhoneOff size={18} />No Answer
              </motion.button>
              <motion.button className="wr-dial-btn" onClick={advance} whileHover={{ y: -4 }} whileTap={{ scale: 0.96 }}>
                <SkipForward size={18} />Skip
              </motion.button>
            </motion.div>
          )}

          {phase === 'answered' && (
            <motion.div className="wr-dial-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.button className="wr-dial-btn green" onClick={() => setPhase('interested')} whileHover={{ y: -4 }}><Star size={18} />Interested</motion.button>
              <motion.button className="wr-dial-btn red" onClick={() => handleDisposition('not_interested')} whileHover={{ y: -4 }}><X size={18} />Not Interested</motion.button>
              <motion.button className="wr-dial-btn" onClick={() => setPhase('idle')} whileHover={{ y: -4 }}><Undo2 size={18} />Back</motion.button>
            </motion.div>
          )}

          {phase === 'no_answer' && (
            <motion.div className="wr-dial-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.button className="wr-dial-btn red" onClick={() => handleDisposition('bad_number')} whileHover={{ y: -4 }}><AlertTriangle size={18} />Bad Number</motion.button>
              <motion.button className="wr-dial-btn amber" onClick={() => handleDisposition('contacted')} whileHover={{ y: -4 }}><PhoneMissed size={18} />Voicemail</motion.button>
              <motion.button className="wr-dial-btn" onClick={() => setPhase('idle')} whileHover={{ y: -4 }}><Undo2 size={18} />Back</motion.button>
            </motion.div>
          )}

          {phase === 'interested' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Call notes..." rows={3}
                style={{ background: 'var(--wr-surface-2)', border: '1px solid var(--wr-border)', borderRadius: 'var(--wr-radius)', padding: 12, color: 'var(--wr-text)', fontFamily: 'var(--wr-font-sans)', fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <CalendarDays size={14} style={{ color: 'var(--wr-text-ghost)' }} />
                <input type="date" value={fuDate} onChange={e => setFuDate(e.target.value)}
                  style={{ background: 'var(--wr-surface-2)', border: '1px solid var(--wr-border)', borderRadius: 'var(--wr-radius)', padding: '8px 12px', color: 'var(--wr-text)', fontFamily: 'var(--wr-font-mono)', fontSize: 12, flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <motion.button className="wr-dial-btn green" style={{ flex: 1 }} onClick={() => handleDisposition('interested')} whileHover={{ y: -3 }}>Save & Next</motion.button>
                <motion.button className="wr-dial-btn" onClick={() => setPhase('answered')} whileHover={{ y: -3 }}>Back</motion.button>
              </div>
            </motion.div>
          )}

          {lastBadIdx !== null && (
            <motion.button className="wr-btn sm" style={{ alignSelf: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              onClick={() => { if (queue[lastBadIdx]) updateStatus.mutate({ id: (queue[lastBadIdx] as Lead).lead_id, status: 'queued' }); setLastBadIdx(null) }}>
              <Undo2 size={11} /> Undo Bad Number
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════
// KPI VIEW
// ═══════════════════════════════════════════════════
function KpiView() {
  const { data: kpi } = useQuery({ queryKey: ['kpi-summary'], queryFn: () => hermesClient.kpi.summary(), refetchInterval: 30_000 })
  const { data: calls } = useQuery({ queryKey: ['kpi-calls'], queryFn: () => hermesClient.kpi.calls() })
  const { data: funnel } = useQuery({ queryKey: ['kpi-funnel'], queryFn: () => hermesClient.kpi.funnel() })
  const { data: daily } = useQuery({ queryKey: ['kpi-daily', 30], queryFn: () => hermesClient.kpi.daily(30) })
  const { data: sourceRoi } = useQuery({ queryKey: ['source-roi'], queryFn: () => hermesClient.kpi.sourceRoi() })
  const { data: followUps } = useQuery({ queryKey: ['follow-ups'], queryFn: () => hermesClient.followUps.list('all') })

  const topMetrics = useMemo(() => (!kpi ? [] : [
    { label: 'Total Leads', value: kpi.total_leads || 0 },
    { label: 'Deals Closed', value: kpi.deals_closed || 0, color: 'green' },
    { label: 'Pipeline Value', value: kpi.pipeline_value || 0, color: 'accent', prefix: '$', formatFn: fmtCounter },
    { label: 'Follow-Ups Due', value: kpi.follow_ups_due || 0, color: (kpi.follow_ups_due || 0) > 0 ? 'warm' : '' },
  ]), [kpi])

  const callMetrics = useMemo(() => (!calls ? [] : [
    { label: 'Calls (7d)', value: calls.total_calls || 0 },
    { label: 'Contacted', value: calls.contacted || 0, color: 'cyan' },
    { label: 'Contact Rate', value: calls.total_calls ? Math.round((calls.contacted / calls.total_calls) * 100) : 0, suffix: '%' },
    { label: 'Interest Rate', value: calls.contacted ? Math.round(((calls.interested || 0) / calls.contacted) * 100) : 0, color: 'warm', suffix: '%' },
  ]), [calls])

  const funnelData = useMemo(() => {
    if (!funnel) return []
    const stages = ['imported', 'enriched', 'queued', 'contacted', 'interested', 'under_contract', 'closed_won']
    const max = Math.max(1, ...stages.map(s => (funnel as Record<string, number>)[s] || 0))
    return stages.map(s => ({ name: s.replace(/_/g, ' '), value: (funnel as Record<string, number>)[s] || 0, pct: ((funnel as Record<string, number>)[s] || 0) / max * 100 }))
  }, [funnel])

  const chartData = useMemo(() => {
    if (!daily || !Array.isArray(daily)) return []
    return daily.map((d: { date: string; calls: number; interested: number }) => ({
      day: new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      calls: d.calls || 0,
      interested: d.interested || 0,
    }))
  }, [daily])

  const overdue = useMemo(() => (followUps || []).filter((f: { status: string; scheduled_date: string }) =>
    f.status !== 'completed' && new Date(f.scheduled_date) < new Date()
  ), [followUps])

  const isLoading = !kpi

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Metrics */}
      <div className="wr-grid-4">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="wr-metric"><Skeleton baseColor="oklch(0.16 0.02 270)" highlightColor="oklch(0.22 0.025 270)" width={60} height={8} /><Skeleton baseColor="oklch(0.16 0.02 270)" highlightColor="oklch(0.22 0.025 270)" width={100} height={32} /></div>
        )) : topMetrics.map((m, i) => (
          <motion.div key={m.label} className="wr-metric" custom={i} variants={panelVariants} initial="hidden" animate="visible" whileHover={{ y: -3 }}>
            <span className="wr-metric-label">{m.label}</span>
            <AnimatedCounter value={m.value} prefix={m.prefix || ''} suffix={m.suffix || ''} className={`wr-metric-value ${m.color || ''}`} formatFn={m.formatFn} />
          </motion.div>
        ))}
      </div>

      {/* Call Metrics */}
      <div className="wr-grid-4">
        {callMetrics.map((m, i) => (
          <motion.div key={m.label} className="wr-metric" custom={i + 4} variants={panelVariants} initial="hidden" animate="visible" whileHover={{ y: -3 }}>
            <span className="wr-metric-label">{m.label}</span>
            <AnimatedCounter value={m.value} suffix={m.suffix || ''} className={`wr-metric-value ${m.color || ''}`} />
          </motion.div>
        ))}
      </div>

      <div className="wr-grid-2">
        {/* 30-Day Activity Chart */}
        <motion.div className="wr-glow-panel accent" custom={2} variants={panelVariants} initial="hidden" animate="visible">
          <div className="wr-panel-header"><TrendingUp size={14} style={{ color: 'var(--wr-accent)' }} /><span className="wr-panel-title">30-Day Activity</span></div>
          <div className="wr-panel-body">
            {chartData.length > 0 ? (
              <div className="wr-chart-wrap" style={{ height: 200 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.accent} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={chartColors.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="areaGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.warm} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={chartColors.warm} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" tick={{ fill: chartColors.text, fontSize: 9, fontFamily: 'var(--wr-font-mono)' }} axisLine={{ stroke: chartColors.gridLine }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background: 'oklch(0.14 0.02 270 / 0.95)', border: '1px solid oklch(0.28 0.03 270 / 0.5)', borderRadius: 8, fontFamily: 'var(--wr-font-mono)', fontSize: 11, color: 'oklch(0.93 0.008 270)', backdropFilter: 'blur(12px)' }} />
                    <Area type="monotone" dataKey="calls" stroke={chartColors.accent} fill="url(#areaGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="interested" stroke={chartColors.warm} fill="url(#areaGrad2)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="wr-empty"><Activity size={20} /><span>No activity data</span></div>}
          </div>
        </motion.div>

        {/* Funnel */}
        <motion.div className="wr-glow-panel" custom={3} variants={panelVariants} initial="hidden" animate="visible">
          <div className="wr-panel-header"><Target size={14} style={{ color: 'var(--wr-accent)' }} /><span className="wr-panel-title">30-Day Funnel</span></div>
          <div className="wr-panel-body">
            {funnelData.map((s, i) => (
              <motion.div key={s.name} className="wr-funnel-stage" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                <span className="wr-funnel-label">{s.name}</span>
                <div className="wr-funnel-bar-track">
                  <motion.div className="wr-funnel-bar-fill" initial={{ width: 0 }} animate={{ width: `${s.pct}%` }} transition={{ delay: i * 0.06 + 0.3, duration: 0.8 }} />
                </div>
                <span className="wr-funnel-count">{s.value}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Source ROI + Overdue */}
      <div className="wr-grid-2">
        <motion.div className="wr-glow-panel green" custom={4} variants={panelVariants} initial="hidden" animate="visible">
          <div className="wr-panel-header"><Layers size={14} style={{ color: 'var(--wr-green)' }} /><span className="wr-panel-title">Source ROI</span></div>
          <div className="wr-panel-body" style={{ padding: 0 }}>
            <table className="wr-table">
              <thead><tr><th>Source</th><th>Total</th><th>Interested</th><th>Won</th></tr></thead>
              <tbody>
                {(sourceRoi || []).map((s: { source: string; total: number; interested: number; won: number }) => (
                  <tr key={s.source}>
                    <td className="bright">{s.source}</td>
                    <td className="mono">{s.total}</td>
                    <td className="mono" style={{ color: s.interested > 0 ? 'var(--wr-warm)' : undefined }}>{s.interested}</td>
                    <td className="mono" style={{ color: s.won > 0 ? 'var(--wr-green)' : undefined }}>{s.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {overdue.length > 0 && (
          <motion.div className="wr-glow-panel hot" custom={5} variants={panelVariants} initial="hidden" animate="visible">
            <div className="wr-panel-header"><AlertTriangle size={14} style={{ color: 'var(--wr-hot)' }} /><span className="wr-panel-title">Overdue</span><span className="wr-panel-count" style={{ color: 'var(--wr-hot)' }}>{overdue.length}</span></div>
            <div className="wr-panel-body" style={{ padding: 0 }}>
              {overdue.slice(0, 10).map((f: { id: number; lead_id: string; scheduled_date: string; notes: string }) => (
                <div key={f.id} className="wr-lead-row">
                  <span className="wr-dot hot" />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500 }}>{f.lead_id}</div><div style={{ fontSize: 10, color: 'var(--wr-text-ghost)' }}>{f.notes || '—'}</div></div>
                  <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 10, color: 'var(--wr-hot)' }}>{new Date(f.scheduled_date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// UNDERWRITING
// ═══════════════════════════════════════════════════
function UnderwritingView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: reports } = useQuery({ queryKey: ['underwriting-reports'], queryFn: () => hermesClient.underwriting.reports() })

  const selectedReport = useMemo(() => {
    if (!selectedId || !reports) return null
    return (reports as UnderwritingReport[]).find(r => r.lead_id === selectedId) || null
  }, [selectedId, reports])

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 300, borderRight: '1px solid oklch(0.22 0.02 270 / 0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'oklch(0.10 0.016 270 / 0.6)', backdropFilter: 'blur(12px)' }}>
        <div className="wr-panel-header"><FileText size={14} style={{ color: 'var(--wr-accent)' }} /><span className="wr-panel-title">Deals</span><span className="wr-panel-count">{(reports || []).length}</span></div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {(reports || []).map((r: UnderwritingReport, i: number) => (
            <motion.div key={r.lead_id} className={`wr-lead-row ${selectedId === r.lead_id ? 'selected' : ''}`} onClick={() => setSelectedId(r.lead_id)}
              initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} whileHover={{ x: 4 }}>
              <span className={`wr-grade ${gradeClass(r.overall_grade)}`}>{r.overall_grade || '?'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wr-text)' }}>{r.address_full || r.lead_id}</div>
                <div style={{ fontSize: 10, color: 'var(--wr-text-ghost)' }}>{r.owner_name || '—'}</div>
              </div>
            </motion.div>
          ))}
          {(!reports || reports.length === 0) && <div className="wr-empty"><FileText size={24} /><span>No reports</span></div>}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {selectedReport ? (
          <motion.div key={selectedReport.lead_id} style={{ flex: 1, overflow: 'auto', padding: 24 }}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <motion.span className={`wr-grade ${gradeClass(selectedReport.overall_grade)}`} style={{ width: 44, height: 44, fontSize: 20 }}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 15 }}>
                {selectedReport.overall_grade}
              </motion.span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>{selectedReport.address_full}</div>
                <div style={{ fontSize: 12, color: 'var(--wr-text-ghost)' }}>{selectedReport.owner_name} · {selectedReport.recommendation || '—'}</div>
              </div>
            </div>

            <div className="wr-grid-3" style={{ marginBottom: 20 }}>
              {[
                { label: 'ARV', value: fmt(selectedReport.arv_final), color: 'green' },
                { label: 'MAO (70%)', value: fmt(selectedReport.mao_70), color: 'accent' },
                { label: 'Repair Est', value: fmt(selectedReport.repair_estimate_low != null && selectedReport.repair_estimate_high != null ? Math.round((selectedReport.repair_estimate_low + selectedReport.repair_estimate_high) / 2) : null), color: 'warm' },
              ].map((m, i) => (
                <motion.div key={m.label} className="wr-metric" custom={i} variants={panelVariants} initial="hidden" animate="visible">
                  <span className="wr-metric-label">{m.label}</span>
                  <span className={`wr-metric-value ${m.color}`} style={{ fontSize: 20 }}>{m.value}</span>
                </motion.div>
              ))}
            </div>

            {selectedReport.arv_final && (
              <motion.div className="wr-glow-panel" style={{ marginBottom: 16 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <div className="wr-panel-header"><span className="wr-panel-title">ARV Sources</span></div>
                <div className="wr-panel-body">
                  <div className="wr-detail-row"><span className="wr-detail-key">PropStream</span><span className="wr-detail-val">{fmt(selectedReport.arv_propstream)}</span></div>
                  <div className="wr-detail-row"><span className="wr-detail-key">County Tax (×1.1)</span><span className="wr-detail-val">{fmt(selectedReport.arv_county)}</span></div>
                  <div className="wr-detail-row"><span className="wr-detail-key">Final</span><span className="wr-detail-val" style={{ color: 'var(--wr-green)' }}>{fmt(selectedReport.arv_final)}</span></div>
                </div>
              </motion.div>
            )}

            {selectedReport.situation_summary && (
              <motion.div className="wr-glow-panel" style={{ marginBottom: 16 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <div className="wr-panel-header"><span className="wr-panel-title">Situation</span></div>
                <div className="wr-panel-body">
                  <div style={{ fontSize: 13, color: 'var(--wr-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{selectedReport.situation_summary}</div>
                </div>
              </motion.div>
            )}

            {(selectedReport as any).urls && (selectedReport as any).urls.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(selectedReport as any).urls.map((u: { label: string; url: string }, i: number) => (
                  <motion.a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className="wr-btn sm"
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <ExternalLink size={10} /> {u.label}
                  </motion.a>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <div className="wr-empty" style={{ flex: 1 }}><FileText size={36} /><span>Select a deal</span></div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════
function AgentsView() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'fleet' | 'proposals'>('fleet')

  const { data: agents } = useQuery({ queryKey: ['agents-list'], queryFn: () => hermesClient.agents.list(), refetchInterval: 10_000 })
  const { data: proposals } = useQuery({
    queryKey: ['agent-pending-proposals'],
    queryFn: () => hermesClient.agents.proposals.list({ status: 'pending', limit: 20 }),
    refetchInterval: 8_000,
  })

  const runAgent = useMutation({
    mutationFn: (type: string) => hermesClient.agents.run(type),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents-list'] }); toast.success('Agent run started') },
  })

  const approveProposal = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.approve(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['agent-pending-proposals'] })
      const prev = qc.getQueryData<Proposal[]>(['agent-pending-proposals'])
      qc.setQueryData<Proposal[]>(['agent-pending-proposals'], old => (old || []).filter(p => p.id !== id))
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['agent-pending-proposals'], ctx.prev)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['agent-pending-proposals'] }) },
    onSuccess: () => { toast.success('Proposal approved') },
  })

  const denyProposal = useMutation({
    mutationFn: (id: number) => hermesClient.agents.proposals.deny(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['agent-pending-proposals'] })
      const prev = qc.getQueryData<Proposal[]>(['agent-pending-proposals'])
      qc.setQueryData<Proposal[]>(['agent-pending-proposals'], old => (old || []).filter(p => p.id !== id))
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['agent-pending-proposals'], ctx.prev)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['agent-pending-proposals'] }) },
  })

  const bulkApproveInfo = useMutation({
    mutationFn: () => {
      const infoIds = (proposals || []).filter(isInformational).map(p => p.id)
      if (infoIds.length === 0) return Promise.resolve({ approved: 0 })
      return hermesClient.agents.proposals.bulkApprove(infoIds)
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['agent-pending-proposals'] })
      const prev = qc.getQueryData<Proposal[]>(['agent-pending-proposals'])
      qc.setQueryData<Proposal[]>(['agent-pending-proposals'], old => (old || []).filter(p => !isInformational(p)))
      return { prev }
    },
    onError: (_err, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['agent-pending-proposals'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['agent-pending-proposals'] }) },
    onSuccess: (data) => { toast.success(`${data.approved} proposals acknowledged`) },
  })

  const infoCount = (proposals || []).filter(isInformational).length
  void ((proposals || []).length - infoCount)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="wr-tabs">
          <button className={`wr-tab ${tab === 'fleet' ? 'active' : ''}`} onClick={() => setTab('fleet')}>Fleet</button>
          <button className={`wr-tab ${tab === 'proposals' ? 'active' : ''}`} onClick={() => setTab('proposals')}>
            Proposals {(proposals || []).length > 0 && <span style={{ color: 'var(--wr-hot)', marginLeft: 4 }}>({(proposals || []).length})</span>}
          </button>
        </div>
        {tab === 'proposals' && infoCount > 0 && (
          <motion.button
            className="wr-btn sm primary"
            onClick={() => bulkApproveInfo.mutate()}
            disabled={bulkApproveInfo.isPending}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            style={{ marginLeft: 'auto' }}
          >
            <Check size={12} /> Acknowledge All ({infoCount})
          </motion.button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'fleet' && (
          <motion.div key="fleet" className="wr-grid-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {(agents || []).map((a, i) => (
              <motion.div key={a.agent_type} className="wr-glow-panel" custom={i} variants={panelVariants} initial="hidden" animate="visible">
                <div className="wr-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`wr-dot ${a.enabled ? (a.last_run_status === 'running' ? 'running' : 'queued') : 'dead'}`} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{a.display_name}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 9, color: 'var(--wr-text-ghost)', letterSpacing: 1, textTransform: 'uppercase' }}>{a.schedule || 'Manual'}</span>
                    <span style={{ fontFamily: 'var(--wr-font-mono)', fontSize: 10, color: a.last_run_status === 'running' ? 'var(--wr-warm)' : 'var(--wr-text-ghost)' }}>
                      {a.last_run_status || 'idle'}
                    </span>
                  </div>
                  <motion.button className={`wr-btn sm ${a.last_run_status === 'running' ? 'danger' : 'primary'}`}
                    onClick={() => runAgent.mutate(a.agent_type)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}>
                    {a.last_run_status === 'running' ? <><Activity size={11} /> Running</> : <><Zap size={11} /> Run</>}
                  </motion.button>
                </div>
              </motion.div>
            ))}
            {(!agents || agents.length === 0) && <div className="wr-empty" style={{ gridColumn: '1 / -1' }}><Radio size={28} /><span>No agents configured</span></div>}
          </motion.div>
        )}

        {tab === 'proposals' && (
          <motion.div key="proposals" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {(proposals || []).map((p: Proposal, i: number) => {
              const info = isInformational(p)
              return (
                <motion.div key={p.id} className="wr-glow-panel" custom={i} variants={panelVariants} initial="hidden" animate="visible">
                  <div className="wr-panel-header">
                    <span className={`wr-dot ${info ? 'contacted' : p.priority === 'high' ? 'hot' : p.priority === 'medium' ? 'interested' : 'queued'}`} />
                    <span className="wr-panel-title">{p.title}</span>
                    <span className="wr-panel-count">{p.agent_type}</span>
                  </div>
                  <div className="wr-panel-body" style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--wr-text-secondary)', lineHeight: 1.6 }}>
                      {proposalDescription(p)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                      {info ? (
                        <motion.button className="wr-btn sm" onClick={() => approveProposal.mutate(p.id)} whileHover={{ scale: 1.05 }}>
                          <Check size={11} /> Okay
                        </motion.button>
                      ) : (
                        <>
                          <motion.button className="wr-btn sm success" onClick={() => approveProposal.mutate(p.id)} whileHover={{ scale: 1.05 }}>
                            <Check size={11} /> Approve
                          </motion.button>
                          <motion.button className="wr-btn sm danger" onClick={() => denyProposal.mutate(p.id)} whileHover={{ scale: 1.05 }}>
                            <X size={11} /> Deny
                          </motion.button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
            {(!proposals || proposals.length === 0) && <div className="wr-empty"><Shield size={28} /><span>No pending proposals</span></div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
