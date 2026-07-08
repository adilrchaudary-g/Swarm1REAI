import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import type { DistressedProperty } from '../../../api/types'

function streetViewEmbedUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/embed?pb=!4v0!6m8!1m7!1s!2m2!1d${lat}!2d${lng}!3f0!4f0!5f0.7820865974627469`
}

function streetViewLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
}

function mapThumbnailUrl(_lat: number, _lng: number, address: string, city: string, state: string): string {
  const q = encodeURIComponent(`${address}, ${city}, ${state}`)
  return `https://maps.google.com/maps?q=${q}&t=m&z=18&output=embed`
}

function severityLabel(s: number): { text: string; color: string; bg: string } {
  if (s >= 2) return { text: 'SEVERE', color: '#ef4444', bg: '#ef444420' }
  return { text: 'MODERATE', color: '#f59e0b', bg: '#f59e0b20' }
}

function formatCity(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function DistressedProperties() {
  const [severityFilter, setSeverityFilter] = useState<number | null>(null)
  const [cityFilter, setCityFilter] = useState('')
  const [selected, setSelected] = useState<DistressedProperty | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['distressed-properties', severityFilter, cityFilter],
    queryFn: () => hermesClient.distressedProperties.list({
      severity: severityFilter ?? undefined,
      city: cityFilter || undefined,
      limit: 500,
    }),
    refetchInterval: false,
  })

  const properties = data?.properties ?? []
  const cities = data?.cities ?? []
  const total = data?.total ?? 0

  const severeCt = useMemo(() => properties.filter(p => p.severity >= 2).length, [properties])
  const moderateCt = useMemo(() => properties.filter(p => p.severity === 1).length, [properties])

  if (isLoading) return <div style={{ color: '#64748b', padding: 24 }}>Loading distressed properties...</div>

  return (
    <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 120px)' }}>
      {/* Left: card grid */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: '0 0 6px' }}>Distressed Properties</h2>
          <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
            {total.toLocaleString()} visually distressed properties from code violation portals. Click to inspect.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterBtn active={severityFilter === null} onClick={() => setSeverityFilter(null)}>
            All ({properties.length})
          </FilterBtn>
          <FilterBtn active={severityFilter === 2} onClick={() => setSeverityFilter(severityFilter === 2 ? null : 2)} color="#ef4444">
            Severe ({severeCt})
          </FilterBtn>
          <FilterBtn active={severityFilter === 1} onClick={() => setSeverityFilter(severityFilter === 1 ? null : 1)} color="#f59e0b">
            Moderate ({moderateCt})
          </FilterBtn>

          <span style={{ color: '#333', margin: '0 4px' }}>|</span>

          <select
            value={cityFilter}
            onChange={e => setCityFilter(e.target.value)}
            style={{ background: 'rgba(99,102,241,0.12)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '4px 8px', fontSize: 11 }}
          >
            <option value="">All Cities</option>
            {cities.sort().map(c => <option key={c} value={c}>{formatCity(c)}</option>)}
          </select>
        </div>

        {/* Property card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {properties.map((p, i) => {
            const sev = severityLabel(p.severity)
            const isSelected = selected?.address === p.address && selected?.lat === p.lat
            return (
              <div
                key={`${p.lat}-${p.lng}-${i}`}
                onClick={() => setSelected(p)}
                style={{
                  background: isSelected ? '#1a1a3a' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? '#6366f1' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 14,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Map thumbnail + severity badge */}
                <div style={{ width: '100%', height: 160, background: '#0a0a14', position: 'relative', overflow: 'hidden' }}>
                  <iframe
                    src={mapThumbnailUrl(p.lat, p.lng, p.address, p.city, p.state)}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
                    tabIndex={-1}
                  />
                  <span style={{
                    position: 'absolute', top: 8, right: 8,
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: sev.bg, color: sev.color, backdropFilter: 'blur(4px)',
                  }}>
                    {sev.text}
                  </span>
                </div>

                {/* Info */}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {p.address}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>
                    {p.city}, {p.state} {p.zip}
                  </div>
                  <div style={{
                    fontSize: 11, color: p.severity >= 2 ? '#ef4444' : '#f59e0b',
                    lineHeight: 1.4,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {p.violation_type}
                    {p.violation_subtype ? ` — ${p.violation_subtype}` : ''}
                  </div>
                  {p.date_opened && (
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
                      Opened: {p.date_opened}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {properties.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#475569' }}>
            No distressed properties match the current filter.
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      {selected && (
        <div style={{
          width: 400, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14, padding: 0, position: 'sticky', top: 0,
          maxHeight: 'calc(100vh - 120px)', overflow: 'auto', flexShrink: 0,
        }}>
          {/* Interactive Street View */}
          <div style={{ width: '100%', height: 300, background: '#0a0a14', position: 'relative' }}>
            <iframe
              key={`${selected.lat}-${selected.lng}`}
              src={streetViewEmbedUrl(selected.lat, selected.lng)}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allowFullScreen
            />
            <button
              onClick={() => setSelected(null)}
              style={{
                position: 'absolute', top: 8, right: 8,
                background: '#000a', border: 'none', color: '#fff', fontSize: 18,
                width: 28, height: 28, borderRadius: 4, cursor: 'pointer', zIndex: 10,
              }}
            ><X size={16} /></button>
          </div>

          <div style={{ padding: 16 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: '0 0 4px', fontWeight: 700 }}>
              {selected.address}
            </h3>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              {selected.city}, {selected.state} {selected.zip}
            </div>

            {/* Severity badge */}
            <div style={{ marginBottom: 12 }}>
              {(() => { const s = severityLabel(selected.severity); return (
                <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
                  {s.text}
                </span>
              )})()}
            </div>

            {/* Violation details */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Violation</div>
              <div style={{ color: '#e2e8f0', fontSize: 13 }}>{selected.violation_type}</div>
              {selected.violation_subtype && (
                <div style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{selected.violation_subtype}</div>
              )}
            </div>

            {selected.date_opened && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Date Opened</div>
                <div style={{ color: '#cbd5e1', fontSize: 13 }}>{selected.date_opened}</div>
              </div>
            )}

            {selected.case_id && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Case ID</div>
                <div style={{ color: '#cbd5e1', fontSize: 13 }}>{selected.case_id}</div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Source</div>
              <div style={{ color: '#cbd5e1', fontSize: 13 }}>{formatCity(selected.source_city)} Portal</div>
            </div>

            {/* Action links */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a
                href={streetViewLink(selected.lat, selected.lng)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', padding: '10px 16px', borderRadius: 6, textAlign: 'center',
                  fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  background: '#6366f120', color: '#818cf8', border: '1px solid #6366f140',
                }}
              >
                Open in Google Street View
              </a>
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(selected.address + ', ' + selected.city + ', ' + selected.state)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', padding: '10px 16px', borderRadius: 6, textAlign: 'center',
                  fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40',
                }}
              >
                Open in Google Maps
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterBtn({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  const c = color || '#6366f1'
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? c : 'rgba(255,255,255,0.08)'}`,
      background: active ? c + '20' : 'transparent',
      color: active ? c : '#666',
    }}>{children}</button>
  )
}
