import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { CourtRecordCase } from '../../../api/types'

type SubView = 'cases' | 'scrape' | 'counties'

export function CourtRecordsPanel() {
  const [subView, setSubView] = useState<SubView>('cases')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { id: 'cases' as const, label: 'Cases' },
          { id: 'scrape' as const, label: 'Scrape Court Records' },
          { id: 'counties' as const, label: 'Counties' },
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

      {subView === 'cases' && <CasesView />}
      {subView === 'scrape' && <ScrapeView />}
      {subView === 'counties' && <CountiesView />}
    </div>
  )
}

function confidenceColor(c: string | null): string {
  if (c === 'high') return '#22c55e'
  if (c === 'medium') return '#f59e0b'
  return '#666'
}

function statusColor(s: string): string {
  if (s === 'qualified') return '#22c55e'
  if (s === 'ingested') return '#6366f1'
  if (s === 'junk') return '#ef4444'
  return '#888'
}

/* ── Cases View ─────────────────────────────────────────────── */

function CasesView() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [ingestResult, setIngestResult] = useState<{ leads_created: number; ingested: number } | null>(null)

  const { data: cases, isLoading } = useQuery({
    queryKey: ['court-record-cases', statusFilter],
    queryFn: () => hermesClient.courtRecords.cases.list({
      status: statusFilter || undefined,
      limit: 200,
    }),
  })

  const classify = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      hermesClient.courtRecords.cases.classify(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['court-record-cases'] }),
  })

  const bulkClassify = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: string }) =>
      hermesClient.courtRecords.cases.bulkClassify(ids, status),
    onSuccess: () => {
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['court-record-cases'] })
      queryClient.invalidateQueries({ queryKey: ['court-record-stats'] })
    },
  })

  const ingest = useMutation({
    mutationFn: (ids: number[]) => hermesClient.courtRecords.ingest(ids),
    onSuccess: (res) => {
      setSelectedIds(new Set())
      setIngestResult(res)
      queryClient.invalidateQueries({ queryKey: ['court-record-cases'] })
      queryClient.invalidateQueries({ queryKey: ['court-record-stats'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    },
  })

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (!cases) return
    if (selectedIds.size === cases.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(cases.map((c) => c.id)))
    }
  }

  if (isLoading) return <div style={{ color: '#666', fontSize: 13 }}>Loading cases...</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '5px 10px', borderRadius: 5, border: '1px solid #2a2a3e',
            background: '#0a0a12', color: '#aaa', fontSize: 12,
          }}
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="qualified">Qualified</option>
          <option value="junk">Junk</option>
          <option value="ingested">Ingested</option>
        </select>

        {selectedIds.size > 0 && (
          <>
            <button
              onClick={() => bulkClassify.mutate({ ids: [...selectedIds], status: 'qualified' })}
              disabled={bulkClassify.isPending}
              style={{ ...bulkBtnStyle('#22c55e'), opacity: bulkClassify.isPending ? 0.6 : 1 }}
            >
              {bulkClassify.isPending ? 'Qualifying...' : `Qualify (${selectedIds.size})`}
            </button>
            <button
              onClick={() => bulkClassify.mutate({ ids: [...selectedIds], status: 'junk' })}
              disabled={bulkClassify.isPending}
              style={{ ...bulkBtnStyle('#ef4444'), opacity: bulkClassify.isPending ? 0.6 : 1 }}
            >
              {bulkClassify.isPending ? 'Junking...' : `Junk (${selectedIds.size})`}
            </button>
            <button
              onClick={() => ingest.mutate([...selectedIds])}
              disabled={ingest.isPending}
              style={{ ...bulkBtnStyle('#6366f1'), opacity: ingest.isPending ? 0.6 : 1 }}
            >
              {ingest.isPending ? 'Ingesting...' : `Ingest (${selectedIds.size})`}
            </button>
          </>
        )}
      </div>

      {(ingest.isError || bulkClassify.isError || classify.isError) && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {ingest.isError && `Ingest failed: ${ingest.error instanceof Error ? ingest.error.message : String(ingest.error)}`}
          {bulkClassify.isError && `Classify failed: ${bulkClassify.error instanceof Error ? bulkClassify.error.message : String(bulkClassify.error)}`}
          {classify.isError && `Classify failed: ${classify.error instanceof Error ? classify.error.message : String(classify.error)}`}
        </div>
      )}

      {ingestResult && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, background: '#22c55e15',
          border: '1px solid #22c55e40', color: '#22c55e', fontSize: 12, marginBottom: 12,
        }}>
          Ingested {ingestResult.ingested} cases, created {ingestResult.leads_created} leads
        </div>
      )}

      {!cases || cases.length === 0 ? (
        <div style={{ color: '#555', fontSize: 13 }}>
          No court record cases yet. Run a scrape from the "Scrape Court Records" tab.
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', fontSize: 11, color: '#555', padding: '4px 0', borderBottom: '1px solid #1e1e2e', marginBottom: 4 }}>
            <div style={{ width: 28 }}>
              <input type="checkbox" checked={selectedIds.size === cases.length} onChange={toggleAll} />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>Case #</div>
            <div style={{ width: 80 }}>Filed</div>
            <div style={{ flex: 1.5, minWidth: 120 }}>Deceased</div>
            <div style={{ flex: 1.5, minWidth: 120 }}>PR Name</div>
            <div style={{ flex: 2, minWidth: 140 }}>Property</div>
            <div style={{ width: 70, textAlign: 'right' }}>Assessed</div>
            <div style={{ width: 60, textAlign: 'center' }}>Match</div>
            <div style={{ width: 70, textAlign: 'center' }}>Status</div>
          </div>

          {cases.map((c) => (
            <CaseRow
              key={c.id}
              c={c}
              selected={selectedIds.has(c.id)}
              expanded={expandedId === c.id}
              onToggleSelect={() => toggleSelect(c.id)}
              onToggleExpand={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onClassify={(status) => classify.mutate({ id: c.id, status })}
              classifyPending={classify.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CaseRow({
  c, selected, expanded, onToggleSelect, onToggleExpand, onClassify, classifyPending,
}: {
  c: CourtRecordCase
  selected: boolean
  expanded: boolean
  onToggleSelect: () => void
  onToggleExpand: () => void
  onClassify: (status: string) => void
  classifyPending?: boolean
}) {
  const addr = [c.property_address, c.property_city, c.property_state].filter(Boolean).join(', ')

  return (
    <div style={{ borderBottom: '1px solid #111' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', padding: '6px 0', fontSize: 12,
          cursor: 'pointer', color: '#ccc',
        }}
        onClick={onToggleExpand}
      >
        <div style={{ width: 28 }} onClick={(e) => { e.stopPropagation(); onToggleSelect() }}>
          <input type="checkbox" checked={selected} readOnly />
        </div>
        <div style={{ flex: 1, minWidth: 100, color: '#818cf8' }}>{c.case_number}</div>
        <div style={{ width: 80, color: '#888' }}>{c.file_date || '-'}</div>
        <div style={{ flex: 1.5, minWidth: 120 }}>{c.deceased_name || '-'}</div>
        <div style={{ flex: 1.5, minWidth: 120, fontWeight: 600 }}>{c.pr_name || '-'}</div>
        <div style={{ flex: 2, minWidth: 140, color: addr ? '#ccc' : '#444' }}>{addr || 'No property found'}</div>
        <div style={{ width: 70, textAlign: 'right', color: '#888' }}>
          {c.assessed_value ? `$${c.assessed_value.toLocaleString()}` : '-'}
        </div>
        <div style={{ width: 60, textAlign: 'center' }}>
          {c.match_confidence && (
            <span style={{ color: confidenceColor(c.match_confidence), fontSize: 11 }}>
              {c.match_confidence}
            </span>
          )}
        </div>
        <div style={{ width: 70, textAlign: 'center' }}>
          <span style={{
            padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
            color: statusColor(c.status), background: statusColor(c.status) + '15',
          }}>
            {c.status}
          </span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '8px 28px 12px', background: '#0a0a14', borderRadius: 6, marginBottom: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, color: '#aaa' }}>
            <div><span style={{ color: '#555' }}>Case Title:</span> {c.case_title || '-'}</div>
            <div><span style={{ color: '#555' }}>Court ID:</span> {c.court_id}</div>
            <div><span style={{ color: '#555' }}>PR Address:</span> {c.pr_address || '-'}</div>
            <div><span style={{ color: '#555' }}>PR Role:</span> {c.pr_role || '-'}</div>
            <div><span style={{ color: '#555' }}>APN:</span> {c.apn || '-'}</div>
            <div><span style={{ color: '#555' }}>Market Value:</span> {c.market_value ? `$${c.market_value.toLocaleString()}` : '-'}</div>
            {c.case_url && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#555' }}>Case URL:</span>{' '}
                <a href={c.case_url} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>
                  View on CaseNet
                </a>
              </div>
            )}
          </div>
          {c.status !== 'ingested' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button onClick={() => onClassify('qualified')} disabled={classifyPending} style={{ ...rowBtnStyle('#22c55e'), opacity: classifyPending ? 0.5 : 1 }}>{classifyPending ? '...' : 'Qualify'}</button>
              <button onClick={() => onClassify('junk')} disabled={classifyPending} style={{ ...rowBtnStyle('#ef4444'), opacity: classifyPending ? 0.5 : 1 }}>{classifyPending ? '...' : 'Junk'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Scrape View ────────────────────────────────────────────── */

function ScrapeView() {
  const queryClient = useQueryClient()
  const [county, setCounty] = useState('Greene')
  const [caseType, setCaseType] = useState('Probate')
  const [daysBack, setDaysBack] = useState(7)
  const [scrapeOpen, setScrapeOpen] = useState(false)
  const [localLog, setLocalLog] = useState<string[]>([])
  const [mutationError, setMutationError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const { data: counties } = useQuery({
    queryKey: ['court-record-counties'],
    queryFn: hermesClient.courtRecords.counties.list,
  })

  const scrape = useMutation({
    mutationFn: () => hermesClient.courtRecords.scrape({ county, case_type: caseType, days_back: daysBack }),
    onMutate: () => {
      setMutationError(null)
      setLocalLog([`Starting scrape: ${county} / ${caseType} / ${daysBack} days back...`])
      setScrapeOpen(true)
    },
    onSuccess: (res) => {
      setLocalLog((prev) => [...prev, res.message || 'Scrape launched — waiting for browser...'])
    },
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : String(err))
      setLocalLog((prev) => [...prev, `ERROR: ${err instanceof Error ? err.message : String(err)}`])
    },
  })

  const { data: scrapeStatus } = useQuery({
    queryKey: ['court-records-scrape-status'],
    queryFn: hermesClient.courtRecords.scrapeStatus,
    refetchInterval: scrapeOpen ? 2_000 : false,
    enabled: scrapeOpen,
  })

  useEffect(() => {
    if (scrapeStatus && !scrapeStatus.running && scrapeStatus.completed_at) {
      queryClient.invalidateQueries({ queryKey: ['court-record-cases'] })
      queryClient.invalidateQueries({ queryKey: ['court-record-stats'] })
    }
  }, [scrapeStatus?.running, scrapeStatus?.completed_at, queryClient])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scrapeStatus?.log_lines?.length, localLog.length])

  const activeCounties = counties?.filter((c) => c.active) || []
  const isRunning = scrape.isPending || scrapeStatus?.running
  const logLines = scrapeStatus?.log_lines?.length ? scrapeStatus.log_lines : localLog
  const phase = scrapeStatus?.phase || (scrape.isPending ? 'starting' : 'idle')

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>County</label>
          <select
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            style={inputStyle}
          >
            {activeCounties.length > 0 ? (
              activeCounties.map((c) => (
                <option key={c.id} value={c.court_id}>{c.county}, {c.state}</option>
              ))
            ) : (
              <option value="Greene">Greene, MO</option>
            )}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>Case Type</label>
          <select value={caseType} onChange={(e) => setCaseType(e.target.value)} style={inputStyle}>
            <option value="Probate">Probate</option>
            <option value="Civil">Civil</option>
            <option value="All">All</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>Days Back</label>
          <input
            type="number"
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            min={1}
            max={90}
            style={{ ...inputStyle, width: 60 }}
          />
        </div>
        <button
          onClick={() => scrape.mutate()}
          disabled={!!isRunning}
          style={{
            padding: '7px 18px', borderRadius: 6,
            border: '1px solid #6366f1',
            background: isRunning ? '#6366f130' : '#6366f120',
            color: '#818cf8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {isRunning ? 'Scraping...' : 'Scrape Court Records'}
        </button>
      </div>

      {scrapeOpen && (
        <div style={{
          background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 8,
          padding: 16, marginTop: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isRunning && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#22c55e', animation: 'statusPulse 1.5s infinite',
                }} />
              )}
              <span style={{ color: '#888', fontSize: 12 }}>
                Phase: <span style={{ color: '#e0e0e0' }}>{phase}</span>
              </span>
            </div>
            {!isRunning && (
              <button
                onClick={() => setScrapeOpen(false)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}
              >
                Close
              </button>
            )}
          </div>

          <div className={`log-tablet${isRunning ? ' active' : scrapeStatus?.error || mutationError ? ' error' : scrapeStatus?.phase === 'complete' ? ' complete' : ''}`} style={{ maxHeight: 300 }}>
            {logLines.map((line, i) => (
              <div key={i} style={{ color: line.includes('ERROR') ? '#ef4444' : line.includes('✓') ? '#22c55e' : line.includes('[court-records]') ? '#6366f1' : '#888' }}>
                {line}
              </div>
            ))}
            {scrape.isPending && logLines.length <= 1 && (
              <div style={{ color: '#f59e0b' }}>Sending request to Hermes...</div>
            )}
            <div ref={logEndRef} />
          </div>

          {(scrapeStatus?.error || mutationError) && (
            <div style={{
              marginTop: 10, padding: '6px 12px', borderRadius: 5,
              background: '#ef444415', border: '1px solid #ef444440',
              color: '#ef4444', fontSize: 12,
            }}>
              {scrapeStatus?.error || mutationError}
            </div>
          )}

          {scrapeStatus && !scrapeStatus.running && scrapeStatus.result && (
            <div style={{
              marginTop: 10, padding: '6px 12px', borderRadius: 5,
              background: '#22c55e15', border: '1px solid #22c55e40',
              color: '#22c55e', fontSize: 12,
            }}>
              Imported {(scrapeStatus.result as any).imported} cases
              ({(scrapeStatus.result as any).duplicates} duplicates)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Counties View ──────────────────────────────────────────── */

function CountiesView() {
  const queryClient = useQueryClient()
  const [newCounty, setNewCounty] = useState('')
  const [newState, setNewState] = useState('MO')
  const [newCourtId, setNewCourtId] = useState('')

  const { data: counties, isLoading } = useQuery({
    queryKey: ['court-record-counties'],
    queryFn: hermesClient.courtRecords.counties.list,
  })

  const upsert = useMutation({
    mutationFn: () => hermesClient.courtRecords.counties.upsert({
      county: newCounty, state: newState, court_id: newCourtId,
    }),
    onSuccess: () => {
      setNewCounty('')
      setNewCourtId('')
      queryClient.invalidateQueries({ queryKey: ['court-record-counties'] })
    },
  })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      hermesClient.courtRecords.counties.toggle(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['court-record-counties'] }),
  })

  if (isLoading) return <div style={{ color: '#666', fontSize: 13 }}>Loading...</div>

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 10 }}>
          Configure which Missouri counties to scrape. The Court ID is used for Case.net's filing date search.
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>County</label>
            <input
              value={newCounty}
              onChange={(e) => setNewCounty(e.target.value)}
              placeholder="e.g. Greene"
              style={{ ...inputStyle, width: 120 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>State</label>
            <input
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              style={{ ...inputStyle, width: 50 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 3 }}>Court ID</label>
            <input
              value={newCourtId}
              onChange={(e) => setNewCourtId(e.target.value)}
              placeholder="e.g. Greene"
              style={{ ...inputStyle, width: 120 }}
            />
          </div>
          <button
            onClick={() => upsert.mutate()}
            disabled={!newCounty || !newCourtId || upsert.isPending}
            style={{
              padding: '6px 14px', borderRadius: 5, border: '1px solid #22c55e40',
              background: upsert.isPending ? '#22c55e30' : '#22c55e15', color: '#22c55e', fontSize: 12, cursor: 'pointer',
            }}
          >
            {upsert.isPending ? 'Adding...' : 'Add County'}
          </button>
        </div>
      </div>

      {(upsert.isError || toggle.isError) && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
        }}>
          {upsert.isError && `Add county failed: ${upsert.error instanceof Error ? upsert.error.message : String(upsert.error)}`}
          {toggle.isError && `Toggle failed: ${toggle.error instanceof Error ? toggle.error.message : String(toggle.error)}`}
        </div>
      )}

      {counties && counties.length > 0 && (
        <div>
          <div style={{ display: 'flex', fontSize: 11, color: '#555', padding: '4px 0', borderBottom: '1px solid #1e1e2e', marginBottom: 4 }}>
            <div style={{ flex: 1 }}>County</div>
            <div style={{ width: 50 }}>State</div>
            <div style={{ flex: 1 }}>Court ID</div>
            <div style={{ width: 60, textAlign: 'center' }}>Cases</div>
            <div style={{ width: 70, textAlign: 'center' }}>Ingested</div>
            <div style={{ width: 100, textAlign: 'center' }}>Last Scraped</div>
            <div style={{ width: 60, textAlign: 'center' }}>Active</div>
          </div>
          {counties.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', fontSize: 12, color: '#ccc', borderBottom: '1px solid #111' }}>
              <div style={{ flex: 1, fontWeight: 600 }}>{c.county}</div>
              <div style={{ width: 50, color: '#888' }}>{c.state}</div>
              <div style={{ flex: 1, color: '#888' }}>{c.court_id}</div>
              <div style={{ width: 60, textAlign: 'center' }}>{c.case_count}</div>
              <div style={{ width: 70, textAlign: 'center', color: '#6366f1' }}>{c.ingested_count}</div>
              <div style={{ width: 100, textAlign: 'center', color: '#666', fontSize: 11 }}>
                {c.last_scraped_at ? new Date(c.last_scraped_at).toLocaleDateString() : 'Never'}
              </div>
              <div style={{ width: 60, textAlign: 'center' }}>
                <button
                  onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                  disabled={toggle.isPending}
                  style={{
                    padding: '2px 8px', borderRadius: 4, border: 'none',
                    cursor: toggle.isPending ? 'wait' : 'pointer',
                    fontSize: 10, fontWeight: 600,
                    opacity: toggle.isPending ? 0.5 : 1,
                    background: c.active ? '#22c55e20' : '#44444420',
                    color: c.active ? '#22c55e' : '#666',
                  }}
                >
                  {c.active ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Shared styles ──────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid #2a2a3e',
  background: '#0a0a12',
  color: '#aaa',
  fontSize: 12,
}

function bulkBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 4, border: `1px solid ${color}40`,
    background: `${color}15`, color, fontSize: 11, cursor: 'pointer', fontWeight: 600,
  }
}

function rowBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '3px 10px', borderRadius: 4, border: `1px solid ${color}30`,
    background: `${color}10`, color, fontSize: 11, cursor: 'pointer',
  }
}
