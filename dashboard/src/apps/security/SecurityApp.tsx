import { Shield, ExternalLink } from 'lucide-react'

const SABSA_URL = 'http://localhost:8080/'

export function SecurityApp() {
  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={18} color="#818cf8" />
        </div>
        <div>
          <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, margin: 0 }}>
            SABSA Framework
          </h2>
          <p style={{ color: '#64748b', fontSize: 12.5, margin: '4px 0 0', maxWidth: 640, lineHeight: 1.55 }}>
            The living SABSA business-analysis framework runs as its own page.
          </p>
        </div>
      </div>

      <a
        href={SABSA_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', borderRadius: 12,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          color: '#c7d2fe', fontSize: 14, fontWeight: 600,
          textDecoration: 'none', transition: 'all 0.2s ease',
        }}
      >
        <ExternalLink size={16} />
        Open SABSA framework
        <span style={{ color: '#6366f1', fontFamily: 'monospace', fontSize: 12, marginLeft: 4 }}>
          {SABSA_URL}
        </span>
      </a>
    </div>
  )
}
