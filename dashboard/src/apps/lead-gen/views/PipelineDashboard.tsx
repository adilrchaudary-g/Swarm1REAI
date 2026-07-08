import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import type { PipelineStats } from '../../../api/types'

const STATUS_STAGES = [
  { key: 'new', label: 'New', color: '#6366f1' },
  { key: 'enriched', label: 'Enriched', color: '#8b5cf6' },
  { key: 'scored', label: 'Scored', color: '#a78bfa' },
  { key: 'queued', label: 'Queued', color: '#06b6d4' },
  { key: 'contacted', label: 'Contacted', color: '#22c55e' },
  { key: 'interested', label: 'Interested', color: '#10b981' },
  { key: 'follow_up', label: 'Follow-Up', color: '#eab308' },
  { key: 'dead', label: 'Dead', color: '#ef4444' },
] as const

function StageCard({ label, color, value, max }: { label: string; color: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{
      flex: 1,
      minWidth: 100,
      background: 'rgba(255,255,255,0.03)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: 16,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: `${pct}%`,
        background: color + '15',
        transition: 'height 0.3s',
      }} />
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      </div>
    </div>
  )
}

export function PipelineDashboard() {
  const queryClient = useQueryClient()
  const [runOutput, setRunOutput] = useState<string | null>(null)

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['pipeline-stats'],
    queryFn: hermesClient.pipeline.stats,
    refetchInterval: 10_000,
  })

  const runPipeline = useMutation({
    mutationFn: () => hermesClient.pipeline.run(),
    onSuccess: (data) => {
      setRunOutput(data.csv_path || 'Pipeline completed')
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
    },
    onError: (err) => setRunOutput(`Error: ${err}`),
  })

  if (isLoading) {
    return <div style={{ color: '#64748b' }}>Loading pipeline stats...</div>
  }

  if (error) {
    return (
      <div>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Pipeline Dashboard</h2>
        <div style={{
          padding: 24, background: 'rgba(99,102,241,0.12)', borderRadius: 14,
          border: '1px solid #2a2a3e', color: '#94a3b8',
        }}>
          <p style={{ marginBottom: 8 }}>Hermes API not connected.</p>
          <p style={{ fontSize: 12, color: '#475569' }}>
            Start the Hermes server: <code style={{ color: '#6366f1' }}>python3 -m hermes serve</code>
          </p>
        </div>
        <div style={{ marginTop: 24 }}>
          <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 12 }}>Pipeline Flow</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {STATUS_STAGES.map((s) => (
              <StageCard key={s.key} label={s.label} color={s.color} value={0} max={1} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const byStatus = (stats as PipelineStats).by_status || {}
  const values = STATUS_STAGES.map((s) => byStatus[s.key] ?? 0)
  const max = Math.max(...values, 1)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: 0 }}>
          Pipeline Dashboard
          <span style={{ color: '#64748b', fontSize: 14, marginLeft: 8 }}>
            ({(stats as PipelineStats).total_leads} total)
          </span>
        </h2>
        <button
          onClick={() => runPipeline.mutate()}
          disabled={runPipeline.isPending}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: runPipeline.isPending ? '#333' : '#6366f1',
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          {runPipeline.isPending ? 'Running...' : 'Run Pipeline'}
        </button>
      </div>

      {runOutput && (
        <div style={{
          padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 12,
          background: runOutput.startsWith('Error:') ? '#1f0f0f' : '#1a2e1a',
          border: `1px solid ${runOutput.startsWith('Error:') ? '#3a1a1a' : '#2a3e2a'}`,
          color: runOutput.startsWith('Error:') ? '#ef4444' : '#4ade80',
        }}>
          {runOutput}
          <button
            onClick={() => setRunOutput(null)}
            style={{ float: 'right', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {STATUS_STAGES.map((stage, i) => (
          <StageCard key={stage.key} label={stage.label} color={stage.color} value={values[i]} max={max} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <BreakdownCard title="By Tier" data={(stats as PipelineStats).by_tier} colors={{
          hot: '#ef4444', warm: '#f97316', lukewarm: '#eab308', cold: '#3b82f6', ice: '#94a3b8',
        }} />
        <BreakdownCard title="By Source" data={(stats as PipelineStats).by_source} colors={{}} />
      </div>
    </div>
  )
}

function BreakdownCard({ title, data, colors }: { title: string; data: Record<string, number>; colors: Record<string, string> }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const total = entries.reduce((s, [, v]) => s + v, 0)
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      {entries.map(([key, val]) => {
        const color = colors[key.toLowerCase()] || '#6366f1'
        const pct = total > 0 ? (val / total) * 100 : 0
        return (
          <div key={key} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span style={{ color: '#ccc' }}>{key}</span>
              <span style={{ color: '#94a3b8' }}>{val}</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
