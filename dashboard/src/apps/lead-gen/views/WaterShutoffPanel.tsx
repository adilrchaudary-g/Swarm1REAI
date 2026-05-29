import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import type { FoiaRequest } from '../../../api/types'

type SubView = 'tracker' | 'import' | 'records'

// Pre-filled agency info for target markets
const AGENCY_PRESETS: { city: string; state: string; agency_name: string; agency_contact: string; submission_method: string; blocked?: boolean; note?: string }[] = [
  { city: 'Cincinnati', state: 'OH', agency_name: 'Greater Cincinnati Water Works (GCWW)', agency_contact: 'cincinnati-oh.gov/water/requesting-public-records/', submission_method: 'online_form' },
  { city: 'Columbus', state: 'OH', agency_name: 'Columbus Division of Water', agency_contact: 'columbus.gov/Services/Columbus-Water-Power/', submission_method: 'online_portal' },
  { city: 'Cleveland', state: 'OH', agency_name: 'Cleveland Water Department', agency_contact: 'clevelandoh.govqa.us', submission_method: 'govqa_portal' },
  { city: 'Akron', state: 'OH', agency_name: 'City of Akron Utilities Bureau', agency_contact: 'akronohio.gov', submission_method: 'email' },
  { city: 'Dayton', state: 'OH', agency_name: 'City of Dayton Water Department', agency_contact: 'daytonohio.gov', submission_method: 'email' },
  { city: 'Toledo', state: 'OH', agency_name: 'City of Toledo Division of Water Reclamation', agency_contact: 'toledo.oh.gov', submission_method: 'email' },
  { city: 'Houston', state: 'TX', agency_name: 'City of Houston Public Works', agency_contact: 'houstontx.gov/publicworks/', submission_method: 'email' },
  { city: 'Dallas', state: 'TX', agency_name: 'Dallas Water Utilities', agency_contact: 'dallascityhall.com', submission_method: 'email' },
  { city: 'Fort Worth', state: 'TX', agency_name: 'Fort Worth Water Department', agency_contact: 'fortworthtexas.gov/water/', submission_method: 'email' },
  { city: 'San Antonio', state: 'TX', agency_name: 'San Antonio Water System (SAWS)', agency_contact: 'saws.org', submission_method: 'email', blocked: true, note: 'BLOCKED - Texas Gov Code 552.1331 exempts SAWS customer data' },
]

export function WaterShutoffPanel() {
  const [subView, setSubView] = useState<SubView>('tracker')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { id: 'tracker' as const, label: 'FOIA Tracker' },
          { id: 'import' as const, label: 'Import Data' },
          { id: 'records' as const, label: 'Records' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubView(tab.id)}
            style={{
              padding: '6px 14px', borderRadius: 5,
              border: `1px solid ${subView === tab.id ? '#6366f1' : '#2a2a3e'}`,
              background: subView === tab.id ? '#6366f120' : 'transparent',
              color: subView === tab.id ? '#818cf8' : '#666',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subView === 'tracker' && <FoiaTracker />}
      {subView === 'import' && <ImportView />}
      {subView === 'records' && <RecordsView />}
    </div>
  )
}

/* ── FOIA Tracker ──────────────────────────────────────────── */

function FoiaTracker() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [letterText, setLetterText] = useState<string | null>(null)
  const [_letterRequestId, setLetterRequestId] = useState<number | null>(null)

  const { data: requests, isLoading } = useQuery({
    queryKey: ['foia-requests'],
    queryFn: hermesClient.waterShutoffs.requests.list,
    refetchInterval: 30_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['water-shutoff-stats'],
    queryFn: hermesClient.waterShutoffs.stats,
    refetchInterval: 30_000,
  })

  const createRequest = useMutation({
    mutationFn: (preset: typeof AGENCY_PRESETS[0]) =>
      hermesClient.waterShutoffs.requests.create({
        city: preset.city,
        state: preset.state,
        agency_name: preset.agency_name,
        agency_contact: preset.agency_contact,
        submission_method: preset.submission_method,
        notes: preset.note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foia-requests'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-stats'] })
      setShowCreate(false)
    },
  })

  const updateRequest = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, unknown> }) =>
      hermesClient.waterShutoffs.requests.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foia-requests'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-stats'] })
    },
  })

  const generateLetter = useMutation({
    mutationFn: (id: number) => hermesClient.waterShutoffs.requests.letter(id),
    onSuccess: (data) => {
      setLetterText(data.letter)
      setLetterRequestId(data.request_id)
    },
  })

  if (isLoading) return <div style={{ color: '#666' }}>Loading...</div>

  const existingCities = new Set((requests || []).map((r) => `${r.city}-${r.state}`))

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {[
            { label: 'Requests', value: stats.total_requests, color: '#6366f1' },
            { label: 'Pending', value: stats.pending_requests, color: '#f59e0b' },
            { label: 'Received', value: stats.received_requests, color: '#22c55e' },
            { label: 'Records', value: stats.total_records, color: '#3b82f6' },
            { label: 'New', value: stats.new_records, color: '#eab308' },
            { label: 'Ingested', value: stats.ingested_records, color: '#22c55e' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ color: '#aaa', fontSize: 14, margin: 0 }}>FOIA Requests</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '6px 14px', borderRadius: 5, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          {showCreate ? 'Cancel' : '+ New Request'}
        </button>
      </div>

      {/* Create panel — pick from presets */}
      {showCreate && (
        <div style={{
          background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
          padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            Select a city to create a FOIA request. Already-created cities are grayed out.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
            {AGENCY_PRESETS.map((preset) => {
              const exists = existingCities.has(`${preset.city}-${preset.state}`)
              const isBlocked = preset.blocked
              return (
                <button
                  key={`${preset.city}-${preset.state}`}
                  onClick={() => !exists && !isBlocked && createRequest.mutate(preset)}
                  disabled={exists || isBlocked || createRequest.isPending}
                  style={{
                    padding: '10px 14px', borderRadius: 6, textAlign: 'left',
                    border: `1px solid ${isBlocked ? '#3a1a1a' : exists ? '#1a1a2e' : '#2a2a3e'}`,
                    background: isBlocked ? '#1f0f0f' : exists ? '#0d0d14' : '#1a1a2e',
                    cursor: exists || isBlocked ? 'not-allowed' : 'pointer',
                    opacity: exists || isBlocked ? 0.5 : 1,
                  }}
                >
                  <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>
                    {preset.city}, {preset.state}
                  </div>
                  <div style={{ color: '#555', fontSize: 10, marginTop: 2 }}>
                    {isBlocked ? preset.note : preset.agency_name}
                  </div>
                  {exists && <div style={{ color: '#6366f1', fontSize: 10, marginTop: 2 }}>Already created</div>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Mutation errors */}
      {(generateLetter.isError || createRequest.isError || updateRequest.isError) && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {generateLetter.isError && `Letter generation failed: ${generateLetter.error instanceof Error ? generateLetter.error.message : String(generateLetter.error)}`}
          {createRequest.isError && `Request creation failed: ${createRequest.error instanceof Error ? createRequest.error.message : String(createRequest.error)}`}
          {updateRequest.isError && `Request update failed: ${updateRequest.error instanceof Error ? updateRequest.error.message : String(updateRequest.error)}`}
        </div>
      )}

      {/* Letter modal */}
      {letterText && (
        <div style={{
          background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
          padding: 20, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ color: '#e0e0e0', fontSize: 14, margin: 0 }}>FOIA Request Letter</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(letterText)
                }}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: '1px solid #2a2a3e',
                  background: '#1a1a2e', color: '#aaa', fontSize: 11, cursor: 'pointer',
                }}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => { setLetterText(null); setLetterRequestId(null) }}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: 'none',
                  background: '#333', color: '#aaa', fontSize: 11, cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
          <pre style={{
            color: '#ccc', fontSize: 12, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', background: '#0a0a12', padding: 16,
            borderRadius: 6, border: '1px solid #1a1a2e', maxHeight: 400,
            overflow: 'auto',
          }}>
            {letterText}
          </pre>
          <div style={{ marginTop: 10, fontSize: 11, color: '#555' }}>
            Fill in [YOUR NAME], [YOUR EMAIL], [YOUR PHONE], and [TODAY'S DATE] before sending.
          </div>
        </div>
      )}

      {/* Request list */}
      {(!requests || requests.length === 0) ? (
        <div style={{ color: '#555', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No FOIA requests yet. Click "+ New Request" to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map((req) => (
            <FoiaRequestRow
              key={req.id}
              request={req}
              onUpdate={(updates) => updateRequest.mutate({ id: req.id, updates })}
              onGenerateLetter={() => generateLetter.mutate(req.id)}
              isUpdating={updateRequest.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#666',
  submitted: '#3b82f6',
  processing: '#f59e0b',
  received: '#22c55e',
  denied: '#ef4444',
  overdue: '#ef4444',
}

function FoiaRequestRow({
  request: req,
  onUpdate,
  onGenerateLetter,
  isUpdating,
}: {
  request: FoiaRequest
  onUpdate: (updates: Record<string, unknown>) => void
  onGenerateLetter: () => void
  isUpdating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const statusColor = STATUS_COLORS[req.status] || '#666'

  const daysAgo = req.submitted_at
    ? Math.floor((Date.now() - new Date(req.submitted_at).getTime()) / 86400000)
    : null

  const isOverdue = req.status === 'submitted' && daysAgo !== null && (
    (req.state === 'TX' && daysAgo > 14) ||
    (req.state === 'OH' && daysAgo > 10)
  )

  return (
    <div style={{
      background: '#111118', border: `1px solid ${isOverdue ? '#3a2a1a' : '#1e1e2e'}`,
      borderRadius: 8, padding: 14,
    }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600 }}>
            {req.city}, {req.state}
          </span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            color: statusColor, background: statusColor + '20',
            textTransform: 'uppercase',
          }}>
            {isOverdue ? 'OVERDUE' : req.status}
          </span>
          {req.records_imported > 0 && (
            <span style={{ fontSize: 11, color: '#22c55e' }}>
              {req.records_imported} records imported
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {daysAgo !== null && (
            <span style={{ fontSize: 11, color: isOverdue ? '#f59e0b' : '#555' }}>
              {daysAgo}d ago
            </span>
          )}
          <span style={{ color: '#444', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid #1a1a2e', paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
            {req.agency_name}
            {req.agency_contact && <> &middot; {req.agency_contact}</>}
          </div>

          {req.notes && (
            <div style={{ fontSize: 11, color: '#888', marginBottom: 10, fontStyle: 'italic' }}>
              {req.notes}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {req.status === 'draft' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onGenerateLetter() }}
                  disabled={isUpdating}
                  style={{
                    padding: '5px 12px', borderRadius: 4, border: 'none',
                    background: '#6366f1', color: '#fff', fontSize: 11,
                    fontWeight: 600, cursor: 'pointer', opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  {isUpdating ? 'Generating...' : 'Generate Letter'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate({ status: 'submitted', submitted_at: new Date().toISOString() })
                  }}
                  disabled={isUpdating}
                  style={{
                    padding: '5px 12px', borderRadius: 4, border: '1px solid #2a2a3e',
                    background: isUpdating ? '#2a2a3e' : '#1a1a2e', color: '#aaa', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {isUpdating ? 'Updating...' : 'Mark as Submitted'}
                </button>
              </>
            )}
            {req.status === 'submitted' && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate({ status: 'processing' })
                  }}
                  disabled={isUpdating}
                  style={{
                    padding: '5px 12px', borderRadius: 4, border: '1px solid #2a2a3e',
                    background: isUpdating ? '#2a2a3e' : '#1a1a2e', color: '#aaa', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {isUpdating ? 'Updating...' : 'Mark Processing'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate({ status: 'received', file_received: 1 })
                  }}
                  disabled={isUpdating}
                  style={{
                    padding: '5px 12px', borderRadius: 4, border: 'none',
                    background: isUpdating ? '#16a34a' : '#22c55e', color: '#fff', fontSize: 11,
                    fontWeight: 600, cursor: 'pointer', opacity: isUpdating ? 0.7 : 1,
                  }}
                >
                  {isUpdating ? 'Updating...' : 'Mark Received'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate({ status: 'denied' })
                  }}
                  disabled={isUpdating}
                  style={{
                    padding: '5px 12px', borderRadius: 4, border: '1px solid #3a1a1a',
                    background: isUpdating ? '#2a0f0f' : '#1f0f0f', color: '#ef4444', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {isUpdating ? 'Updating...' : 'Denied'}
                </button>
              </>
            )}
            {req.status === 'processing' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdate({ status: 'received', file_received: 1 })
                }}
                disabled={isUpdating}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: 'none',
                  background: isUpdating ? '#16a34a' : '#22c55e', color: '#fff', fontSize: 11,
                  fontWeight: 600, cursor: 'pointer', opacity: isUpdating ? 0.7 : 1,
                }}
              >
                {isUpdating ? 'Updating...' : 'Mark Received'}
              </button>
            )}
            {(req.status === 'received' || req.file_received) && (
              <span style={{ fontSize: 11, color: '#22c55e', alignSelf: 'center' }}>
                File received &mdash; go to Import Data tab to upload
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Import View ───────────────────────────────────────────── */

function ImportView() {
  const queryClient = useQueryClient()
  const [pastedCsv, setPastedCsv] = useState('')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState<number | undefined>(undefined)
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number } | null>(null)
  const [fallbackCity, setFallbackCity] = useState('')
  const [fallbackState, setFallbackState] = useState('OH')

  const { data: requests } = useQuery({
    queryKey: ['foia-requests'],
    queryFn: hermesClient.waterShutoffs.requests.list,
  })

  const importRecords = useMutation({
    mutationFn: () =>
      hermesClient.waterShutoffs.import({
        foia_request_id: selectedRequestId,
        records: parsedRows,
        city: fallbackCity || undefined,
        state: fallbackState || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['foia-requests'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-stats'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-records'] })
      setImportResult(data)
      setPastedCsv('')
      setParsedRows([])
    },
  })

  function parseCsv(text: string) {
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
    const rows: Record<string, string>[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Simple CSV parse (handles quoted fields with commas)
      const values: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      values.push(current.trim())

      const row: Record<string, string> = {}
      headers.forEach((h, idx) => {
        row[h] = values[idx] || ''
      })

      // Normalize common header variations
      const normalized: Record<string, string> = {}
      for (const [k, v] of Object.entries(row)) {
        if (/service.?addr|property.?addr|address|location/i.test(k)) {
          normalized['service_address'] = v
        } else if (/account.?holder|owner|name|customer/i.test(k)) {
          normalized['account_holder'] = v
        } else if (/shutoff|disconnect|shut.?off|termination/i.test(k)) {
          normalized['shutoff_date'] = v
        } else if (/amount|balance|owed|due|arrearage/i.test(k)) {
          normalized['amount_owed'] = v
        } else if (/city/i.test(k)) {
          normalized['city'] = v
        } else if (/state/i.test(k)) {
          normalized['state'] = v
        } else if (/zip|postal/i.test(k)) {
          normalized['zip'] = v
        }
      }

      // If no specific address field found, use the first column with a number
      if (!normalized['service_address']) {
        for (const v of Object.values(row)) {
          if (/^\d+\s/.test(v)) {
            normalized['service_address'] = v
            break
          }
        }
      }

      if (normalized['service_address']) {
        rows.push(normalized)
      }
    }
    return rows
  }

  const receivedRequests = (requests || []).filter((r) => r.file_received || r.status === 'received')

  return (
    <div>
      <div style={{
        background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
        padding: 16, marginBottom: 16,
      }}>
        <h4 style={{ color: '#e0e0e0', fontSize: 14, margin: '0 0 10px 0' }}>Import Water Shutoff Data</h4>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>
          Paste CSV data from the file you received. The system auto-detects common column names:
          address, account holder/owner, shutoff/disconnect date, amount/balance, city, state, zip.
        </div>

        {importRecords.isError && (
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 14,
            background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
          }}>
            Import failed: {importRecords.error instanceof Error ? importRecords.error.message : String(importRecords.error)}
          </div>
        )}

        {importResult && (
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 14,
            background: '#0f1f0f', border: '1px solid #1a3a1a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: '#4ade80', fontSize: 13 }}>
              Imported <strong>{importResult.imported}</strong> records ({importResult.duplicates} duplicates skipped)
            </span>
            <button
              onClick={() => setImportResult(null)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
            ><X size={16} /></button>
          </div>
        )}

        {/* Link to FOIA request */}
        {receivedRequests.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
              Link to FOIA Request (optional)
            </label>
            <select
              value={selectedRequestId || ''}
              onChange={(e) => setSelectedRequestId(e.target.value ? parseInt(e.target.value) : undefined)}
              style={{
                padding: '6px 10px', borderRadius: 4, border: '1px solid #2a2a3e',
                background: '#0d0d14', color: '#ccc', fontSize: 12, width: 300,
              }}
            >
              <option value="">None</option>
              {receivedRequests.map((r) => (
                <option key={r.id} value={r.id}>{r.city}, {r.state} - {r.agency_name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Fallback city/state */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
              Default City (if not in data)
            </label>
            <input
              value={fallbackCity}
              onChange={(e) => setFallbackCity(e.target.value)}
              placeholder="e.g. Cincinnati"
              style={{
                padding: '6px 10px', borderRadius: 4, border: '1px solid #2a2a3e',
                background: '#0d0d14', color: '#ccc', fontSize: 12, width: 160,
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
              Default State
            </label>
            <select
              value={fallbackState}
              onChange={(e) => setFallbackState(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 4, border: '1px solid #2a2a3e',
                background: '#0d0d14', color: '#ccc', fontSize: 12,
              }}
            >
              <option value="OH">OH</option>
              <option value="TX">TX</option>
            </select>
          </div>
        </div>

        <textarea
          value={pastedCsv}
          onChange={(e) => {
            setPastedCsv(e.target.value)
            if (e.target.value.trim()) {
              setParsedRows(parseCsv(e.target.value))
            } else {
              setParsedRows([])
            }
          }}
          placeholder="Paste CSV data here (with headers)..."
          style={{
            width: '100%', minHeight: 160, padding: 12, borderRadius: 6,
            border: '1px solid #2a2a3e', background: '#0d0d14', color: '#ccc',
            fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
          }}
        />

        {parsedRows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 8 }}>
              Parsed {parsedRows.length} records
            </div>

            {/* Preview table */}
            <div style={{
              maxHeight: 200, overflow: 'auto', border: '1px solid #1a1a2e',
              borderRadius: 6, marginBottom: 12,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#0d0d14' }}>
                    <th style={{ padding: '6px 8px', color: '#888', textAlign: 'left', borderBottom: '1px solid #1a1a2e' }}>Address</th>
                    <th style={{ padding: '6px 8px', color: '#888', textAlign: 'left', borderBottom: '1px solid #1a1a2e' }}>Owner</th>
                    <th style={{ padding: '6px 8px', color: '#888', textAlign: 'left', borderBottom: '1px solid #1a1a2e' }}>Shutoff Date</th>
                    <th style={{ padding: '6px 8px', color: '#888', textAlign: 'right', borderBottom: '1px solid #1a1a2e' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 10).map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111118' }}>
                      <td style={{ padding: '5px 8px', color: '#ccc' }}>{row.service_address}</td>
                      <td style={{ padding: '5px 8px', color: '#aaa' }}>{row.account_holder || '-'}</td>
                      <td style={{ padding: '5px 8px', color: '#aaa' }}>{row.shutoff_date || '-'}</td>
                      <td style={{ padding: '5px 8px', color: '#aaa', textAlign: 'right' }}>
                        {row.amount_owed ? `$${row.amount_owed}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 10 && (
                <div style={{ padding: 6, textAlign: 'center', color: '#555', fontSize: 10 }}>
                  ... and {parsedRows.length - 10} more
                </div>
              )}
            </div>

            <button
              onClick={() => importRecords.mutate()}
              disabled={importRecords.isPending}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: importRecords.isPending ? '#333' : '#6366f1',
                color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {importRecords.isPending ? 'Importing...' : `Import ${parsedRows.length} Records`}
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{
        background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
        padding: 16,
      }}>
        <h4 style={{ color: '#aaa', fontSize: 13, margin: '0 0 10px 0' }}>Preparing Your Data</h4>
        <ol style={{ color: '#666', fontSize: 12, lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
          <li>Open the file from the water utility (usually CSV or XLSX)</li>
          <li>If XLSX, open in Excel/Sheets and export as CSV</li>
          <li>Select all rows including the header row, copy (Ctrl+C / Cmd+C)</li>
          <li>Paste into the text area above</li>
          <li>Verify the preview looks correct, then click Import</li>
        </ol>
        <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>
          The system matches common header names automatically. Required: at least one address-like column.
          Optional: owner/name, shutoff/disconnect date, amount/balance.
        </div>
      </div>
    </div>
  )
}

/* ── Records View ──────────────────────────────────────────── */

function RecordsView() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('new')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [ingestResult, setIngestResult] = useState<{ leads_created: number; ingested: number } | null>(null)

  const { data: records, isLoading } = useQuery({
    queryKey: ['water-shutoff-records', statusFilter],
    queryFn: () => hermesClient.waterShutoffs.records.list({
      status: statusFilter || undefined,
      limit: 200,
    }),
    refetchInterval: 30_000,
  })

  const ingestRecords = useMutation({
    mutationFn: () => hermesClient.waterShutoffs.ingest(Array.from(selectedIds)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-records'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-stats'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      setSelectedIds(new Set())
      setIngestResult(data)
    },
  })

  const ingestAll = useMutation({
    mutationFn: () => {
      const allNewIds = (records || []).filter((r) => r.status === 'new').map((r) => r.id)
      return hermesClient.waterShutoffs.ingest(allNewIds)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-records'] })
      queryClient.invalidateQueries({ queryKey: ['water-shutoff-stats'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      setIngestResult(data)
    },
  })

  const toggleId = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleAll = () => {
    if (!records) return
    const newRecs = records.filter((r) => r.status === 'new')
    if (selectedIds.size === newRecs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(newRecs.map((r) => r.id)))
    }
  }

  if (isLoading) return <div style={{ color: '#666' }}>Loading records...</div>

  const newCount = (records || []).filter((r) => r.status === 'new').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['new', 'ingested', ''].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => { setStatusFilter(s); setSelectedIds(new Set()) }}
              style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11,
                border: `1px solid ${statusFilter === s ? '#6366f1' : '#2a2a3e'}`,
                background: statusFilter === s ? '#6366f120' : 'transparent',
                color: statusFilter === s ? '#818cf8' : '#666',
                cursor: 'pointer',
              }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {selectedIds.size > 0 && (
            <button
              onClick={() => ingestRecords.mutate()}
              disabled={ingestRecords.isPending}
              style={{
                padding: '6px 14px', borderRadius: 5, border: 'none',
                background: '#6366f1', color: '#fff', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {ingestRecords.isPending ? 'Ingesting...' : `Ingest ${selectedIds.size} Selected`}
            </button>
          )}
          {newCount > 0 && selectedIds.size === 0 && (
            <button
              onClick={() => ingestAll.mutate()}
              disabled={ingestAll.isPending}
              style={{
                padding: '6px 14px', borderRadius: 5, border: 'none',
                background: '#22c55e', color: '#fff', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {ingestAll.isPending ? 'Ingesting...' : `Ingest All ${newCount} New`}
            </button>
          )}
        </div>
      </div>

      {(ingestRecords.isError || ingestAll.isError) && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {ingestRecords.isError && `Ingest failed: ${ingestRecords.error instanceof Error ? ingestRecords.error.message : String(ingestRecords.error)}`}
          {ingestAll.isError && `Ingest failed: ${ingestAll.error instanceof Error ? ingestAll.error.message : String(ingestAll.error)}`}
        </div>
      )}

      {ingestResult && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 12,
          background: '#0f1f0f', border: '1px solid #1a3a1a',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#4ade80', fontSize: 13 }}>
            <strong>{ingestResult.leads_created}</strong> leads created from {ingestResult.ingested} records
          </span>
          <button
            onClick={() => setIngestResult(null)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
          ><X size={16} /></button>
        </div>
      )}

      {(!records || records.length === 0) ? (
        <div style={{ color: '#555', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No records found. Import data from the Import tab.
        </div>
      ) : (
        <div style={{
          border: '1px solid #1e1e2e', borderRadius: 8, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0d0d14' }}>
                {statusFilter === 'new' && (
                  <th style={{ padding: '8px 6px', width: 30 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === newCount}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th style={{ padding: '8px', color: '#888', textAlign: 'left' }}>Address</th>
                <th style={{ padding: '8px', color: '#888', textAlign: 'left' }}>City</th>
                <th style={{ padding: '8px', color: '#888', textAlign: 'left' }}>Owner</th>
                <th style={{ padding: '8px', color: '#888', textAlign: 'left' }}>Shutoff Date</th>
                <th style={{ padding: '8px', color: '#888', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '8px', color: '#888', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr
                  key={rec.id}
                  style={{
                    borderTop: '1px solid #111118',
                    background: selectedIds.has(rec.id) ? '#6366f110' : '#111118',
                  }}
                >
                  {statusFilter === 'new' && (
                    <td style={{ padding: '6px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(rec.id)}
                        onChange={() => toggleId(rec.id)}
                      />
                    </td>
                  )}
                  <td style={{ padding: '6px 8px', color: '#ccc' }}>{rec.service_address}</td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>
                    {[rec.city, rec.state].filter(Boolean).join(', ') || '-'}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{rec.account_holder || '-'}</td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{rec.shutoff_date || '-'}</td>
                  <td style={{ padding: '6px 8px', color: '#aaa', textAlign: 'right' }}>
                    {rec.amount_owed != null ? `$${rec.amount_owed.toLocaleString()}` : '-'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                      color: rec.status === 'ingested' ? '#22c55e' : '#f59e0b',
                      background: (rec.status === 'ingested' ? '#22c55e' : '#f59e0b') + '20',
                    }}>
                      {rec.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
