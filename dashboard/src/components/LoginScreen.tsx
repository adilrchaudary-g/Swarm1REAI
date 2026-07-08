import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../store/auth-store'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { login, error, loading } = useAuthStore()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    await login(username, password)
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 60%), #06060b',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360,
        padding: 32,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#c7d2fe', letterSpacing: -0.5 }}>
            Swarm
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Sign in to your dashboard
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 8,
            color: '#fca5a5',
            fontSize: 13,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 500 }}>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: 14,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 500 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: 14,
              outline: 'none',
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !username || !password}
          style={{
            width: '100%',
            padding: '11px 0',
            background: 'rgba(99,102,241,0.9)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading || !username || !password ? 0.5 : 1,
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
