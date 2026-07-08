import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { Contract, ContractStatus } from '../../api/types'
import { FileText, Download, XCircle, Mail, CheckCircle } from 'lucide-react'
import { PurchaserSettings } from './PurchaserSettings'

const STATUS_COLORS: Record<ContractStatus, string> = {
  draft: '#f59e0b',
  pending_seller: '#6366f1',
  fully_signed: '#22c55e',
  voided: '#ef4444',
  expired: '#64748b',
}

const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Draft',
  pending_seller: 'Awaiting Seller',
  fully_signed: 'Fully Signed',
  voided: 'Voided',
  expired: 'Expired',
}

export function ContractsPanel() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['contracts', filter],
    queryFn: () => hermesClient.contracts.list(filter ? { status: filter } : undefined),
    refetchInterval: 5000,
  })

  const voidContract = useMutation({
    mutationFn: (id: number) => hermesClient.contracts.void(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contracts'] }),
  })

  const filters: { label: string; value: string }[] = [
    { label: 'All', value: '' },
    { label: 'Draft', value: 'draft' },
    { label: 'Awaiting Seller', value: 'pending_seller' },
    { label: 'Signed', value: 'fully_signed' },
    { label: 'Voided', value: 'voided' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, margin: 0 }}>Contracts</h2>
        <button onClick={() => setShowSettings(true)} style={{
          padding: '8px 16px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', color: '#94a3b8', cursor: 'pointer', fontSize: 13,
        }}>Settings</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              background: filter === f.value ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: filter === f.value ? '#c7d2fe' : '#64748b',
              fontWeight: filter === f.value ? 600 : 400,
            }}
          >{f.label}</button>
        ))}
      </div>

      {isLoading ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading contracts...</p>
      ) : contracts.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center', color: '#475569',
          background: 'rgba(255,255,255,0.02)', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          <FileText size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <p style={{ fontSize: 14 }}>No contracts yet</p>
          <p style={{ fontSize: 12, color: '#64748b' }}>
            Generate a contract from any lead's detail panel
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {contracts.map((c: Contract) => (
            <ContractRow
              key={c.id}
              contract={c}
              onVoid={() => {
                if (confirm('Void this contract?')) voidContract.mutate(c.id)
              }}
            />
          ))}
        </div>
      )}

      {showSettings && <PurchaserSettings onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function ContractRow({ contract, onVoid }: { contract: Contract; onVoid: () => void }) {
  const status = contract.status as ContractStatus
  const color = STATUS_COLORS[status] || '#64748b'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px',
      background: 'rgba(255,255,255,0.03)', borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <FileText size={18} style={{ color, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contract.property_address || contract.address_full || 'Unknown Property'}
        </p>
        <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>
          {contract.seller_name || contract.owner_name} &middot; ${(contract.purchase_price || 0).toLocaleString()}
        </p>
      </div>

      <span style={{
        padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: color + '18', color,
      }}>
        {STATUS_LABELS[status] || status}
      </span>

      {contract.signing_email_sent_at && (
        <Mail size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
      )}

      {status === 'fully_signed' && (
        <CheckCircle size={14} style={{ color: '#22c55e', flexShrink: 0 }} />
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        {(contract.pdf_path || contract.signed_pdf_path) && (
          <a
            href={hermesClient.contracts.pdfUrl(contract.id)}
            target="_blank"
            rel="noopener"
            style={{ color: '#94a3b8', cursor: 'pointer' }}
            title="Download PDF"
          >
            <Download size={14} />
          </a>
        )}
        {status !== 'voided' && status !== 'fully_signed' && (
          <button onClick={onVoid} style={{
            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0,
          }} title="Void contract">
            <XCircle size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
