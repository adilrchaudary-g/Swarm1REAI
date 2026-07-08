import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function PurchaserSettings({ onClose }: Props) {
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => hermesClient.settings.get(),
  })

  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserAddress, setPurchaserAddress] = useState('')
  const [gmailUser, setGmailUser] = useState('')
  const [gmailAppPassword, setGmailAppPassword] = useState('')

  useEffect(() => {
    if (settings) {
      setPurchaserName(settings.purchaser_name || '')
      setPurchaserAddress(settings.purchaser_address || '')
      setGmailUser(settings.gmail_user || '')
      setGmailAppPassword(settings.gmail_app_password || '')
    }
  }, [settings])

  const save = useMutation({
    mutationFn: () => hermesClient.settings.update({
      purchaser_name: purchaserName,
      purchaser_address: purchaserAddress,
      gmail_user: gmailUser,
      gmail_app_password: gmailAppPassword,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
      onClose()
    },
  })

  const inputStyle = {
    width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0',
    fontSize: 14, outline: 'none',
  }

  const labelStyle = {
    display: 'block' as const, fontSize: 12, color: '#94a3b8', marginBottom: 4, fontWeight: 500 as const,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 480, background: '#0f172a', borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.08)', padding: 32,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 18, margin: 0 }}>Contract Settings</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
          }}><X size={20} /></button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <p style={{ color: '#c7d2fe', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Purchaser Defaults</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={labelStyle}>Purchaser Name</label>
                <input style={inputStyle} value={purchaserName} onChange={(e) => setPurchaserName(e.target.value)}
                       placeholder="Your name or LLC" />
              </div>
              <div>
                <label style={labelStyle}>Purchaser Address</label>
                <input style={inputStyle} value={purchaserAddress} onChange={(e) => setPurchaserAddress(e.target.value)}
                       placeholder="123 Main St, City, ST 12345" />
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)' }} />

          <div>
            <p style={{ color: '#c7d2fe', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Gmail SMTP</p>
            <p style={{ color: '#64748b', fontSize: 11, marginBottom: 12 }}>
              Used to email contracts to sellers. Requires a Gmail App Password (not your regular password).
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={labelStyle}>Gmail Address</label>
                <input style={inputStyle} value={gmailUser} onChange={(e) => setGmailUser(e.target.value)}
                       placeholder="you@gmail.com" />
              </div>
              <div>
                <label style={labelStyle}>App Password</label>
                <input style={inputStyle} type="password" value={gmailAppPassword}
                       onChange={(e) => setGmailAppPassword(e.target.value)}
                       placeholder="xxxx xxxx xxxx xxxx" />
              </div>
            </div>
          </div>

          <button onClick={() => save.mutate()} disabled={save.isPending} style={{
            width: '100%', padding: '12px', border: 'none', borderRadius: 8,
            background: '#6366f1', color: '#fff', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, marginTop: 8,
            opacity: save.isPending ? 0.6 : 1,
          }}>{save.isPending ? 'Saving...' : 'Save Settings'}</button>

          {save.isError && (
            <p style={{ color: '#ef4444', fontSize: 12, textAlign: 'center' }}>
              Failed to save settings
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
