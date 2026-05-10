import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { SocialComment } from '../../../api/types'

type SubView = 'inbox' | 'campaigns' | 'import'

export function SocialBanditPanel() {
  const [subView, setSubView] = useState<SubView>('inbox')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { id: 'inbox' as const, label: 'Comment Inbox' },
          { id: 'campaigns' as const, label: 'Campaigns' },
          { id: 'import' as const, label: 'Import' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubView(tab.id)}
            style={{
              padding: '6px 14px', border: '1px solid #2a2a3e', borderRadius: 5,
              background: subView === tab.id ? '#6366f1' : '#1a1a2e',
              color: subView === tab.id ? '#fff' : '#888',
              cursor: 'pointer', fontSize: 12,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subView === 'inbox' && <CommentInbox />}
      {subView === 'campaigns' && <CampaignsView />}
      {subView === 'import' && <ImportView />}
    </div>
  )
}

/* ── Stats Bar ─────────────────────────────────────────────── */

/* ── Comment Inbox ─────────────────────────────────────────── */

function CommentInbox() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('new')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: comments, isLoading } = useQuery({
    queryKey: ['social-comments', statusFilter],
    queryFn: () => hermesClient.socialBandit.comments.list({
      status: statusFilter || undefined,
      limit: 200,
    }),
    refetchInterval: 10_000,
  })

  const classify = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      hermesClient.socialBandit.comments.classify(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-comments'] })
      queryClient.invalidateQueries({ queryKey: ['social-bandit-stats'] })
    },
  })

  const bulkClassify = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: string }) =>
      hermesClient.socialBandit.comments.bulkClassify(ids, status),
    onSuccess: () => {
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['social-comments'] })
      queryClient.invalidateQueries({ queryKey: ['social-bandit-stats'] })
    },
  })

  const ingest = useMutation({
    mutationFn: (ids: number[]) => hermesClient.socialBandit.comments.ingest(ids),
    onSuccess: () => {
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['social-comments'] })
      queryClient.invalidateQueries({ queryKey: ['social-bandit-stats'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
  })

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (!comments) return
    if (selected.size === comments.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(comments.map((c) => c.id)))
    }
  }

  const statuses = ['new', 'qualified', 'junk', 'ingested', '']

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
        {statuses.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => { setStatusFilter(s); setSelected(new Set()) }}
            style={{
              padding: '5px 12px', borderRadius: 4, border: 'none',
              background: statusFilter === s ? '#333' : '#1a1a2e',
              color: statusFilter === s ? '#fff' : '#666',
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}
          >
            {s || 'All'}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#888' }}>{selected.size} selected</span>
            <button
              onClick={() => bulkClassify.mutate({ ids: [...selected], status: 'qualified' })}
              style={{ padding: '5px 10px', borderRadius: 4, border: 'none', background: '#22c55e30', color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              Qualify
            </button>
            <button
              onClick={() => bulkClassify.mutate({ ids: [...selected], status: 'junk' })}
              style={{ padding: '5px 10px', borderRadius: 4, border: 'none', background: '#ef444430', color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              Junk
            </button>
            <button
              onClick={() => ingest.mutate([...selected])}
              disabled={ingest.isPending}
              style={{ padding: '5px 10px', borderRadius: 4, border: 'none', background: '#6366f130', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              {ingest.isPending ? 'Ingesting...' : 'Ingest to Pipeline'}
            </button>
          </div>
        )}
      </div>

      {/* Select all */}
      {comments && comments.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={selected.size === comments.length && comments.length > 0}
              onChange={selectAll}
              style={{ accentColor: '#6366f1' }}
            />
            Select all ({comments.length})
          </label>
        </div>
      )}

      {isLoading && <div style={{ color: '#666', fontSize: 13 }}>Loading comments...</div>}

      {/* Comment list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(comments || []).map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            selected={selected.has(comment.id)}
            onToggle={() => toggleSelect(comment.id)}
            onClassify={(status) => classify.mutate({ id: comment.id, status })}
          />
        ))}
      </div>

      {comments && comments.length === 0 && (
        <div style={{ color: '#555', fontSize: 13, padding: 24, textAlign: 'center' }}>
          No comments with status "{statusFilter || 'any'}".
          {statusFilter === 'new' && ' Import comments from Facebook/Instagram ads to get started.'}
        </div>
      )}
    </div>
  )
}

/* ── Comment Row ───────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  new: '#f59e0b',
  qualified: '#22c55e',
  junk: '#ef4444',
  duplicate: '#888',
  ingested: '#6366f1',
}

function CommentRow({
  comment,
  selected,
  onToggle,
  onClassify,
}: {
  comment: SocialComment
  selected: boolean
  onToggle: () => void
  onClassify: (status: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const queryClient = useQueryClient()

  const extract = useMutation({
    mutationFn: (data: { name?: string; phone?: string; address?: string; city?: string; state?: string }) =>
      hermesClient.socialBandit.comments.extract(comment.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-comments'] })
    },
  })

  const [editName, setEditName] = useState(comment.extracted_name || '')
  const [editPhone, setEditPhone] = useState(comment.extracted_phone || '')
  const [editAddress, setEditAddress] = useState(comment.extracted_address || '')
  const [editCity, setEditCity] = useState(comment.extracted_city || '')
  const [editState, setEditState] = useState(comment.extracted_state || '')

  const hasExtracted = comment.extracted_phone || comment.extracted_address || comment.extracted_name

  const platformIcon = comment.platform === 'facebook' ? 'FB'
    : comment.platform === 'instagram' ? 'IG'
    : comment.platform === 'tiktok' ? 'TK'
    : comment.platform?.slice(0, 2).toUpperCase() || '??'

  const typeLabel = comment.post_type === 'own_ad' ? 'Your Ad'
    : comment.post_type === 'competitor_ad' ? 'Competitor'
    : 'Community'

  return (
    <div style={{
      background: selected ? '#1a1a30' : '#111118',
      border: `1px solid ${selected ? '#6366f140' : '#1e1e2e'}`,
      borderRadius: 8, padding: 14,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          style={{ marginTop: 3, accentColor: '#6366f1' }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                background: '#1a1a2e', color: '#888',
              }}>{platformIcon}</span>
              <span style={{ color: '#ccc', fontSize: 13, fontWeight: 600 }}>{comment.commenter_name}</span>
              <span style={{
                padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                background: comment.post_type === 'competitor_ad' ? '#f59e0b20' : '#22c55e20',
                color: comment.post_type === 'competitor_ad' ? '#f59e0b' : '#22c55e',
              }}>{typeLabel}</span>
            </div>
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
              color: STATUS_COLORS[comment.status] || '#666',
              background: (STATUS_COLORS[comment.status] || '#666') + '20',
            }}>{comment.status.toUpperCase()}</span>
          </div>

          {/* Comment text */}
          <div style={{
            fontSize: 13, color: '#bbb', lineHeight: 1.5, marginBottom: 8,
            background: '#0d0d14', borderRadius: 6, padding: '10px 12px',
          }}>
            {comment.comment_text}
          </div>

          {/* Auto-extracted info */}
          {hasExtracted && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              {comment.extracted_name && (
                <span style={{ fontSize: 11, color: '#8b5cf6' }}>
                  Name: <strong>{comment.extracted_name}</strong>
                </span>
              )}
              {comment.extracted_phone && (
                <span style={{ fontSize: 11, color: '#22c55e' }}>
                  Phone: <strong>{comment.extracted_phone}</strong>
                </span>
              )}
              {comment.extracted_address && (
                <span style={{ fontSize: 11, color: '#3b82f6' }}>
                  Address: <strong>{comment.extracted_address}</strong>
                </span>
              )}
              {comment.extracted_city && (
                <span style={{ fontSize: 11, color: '#666' }}>
                  {comment.extracted_city}{comment.extracted_state ? `, ${comment.extracted_state}` : ''}
                </span>
              )}
            </div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {comment.status !== 'qualified' && (
              <button onClick={() => onClassify('qualified')} style={actionBtnStyle('#22c55e')}>
                Qualify
              </button>
            )}
            {comment.status !== 'junk' && (
              <button onClick={() => onClassify('junk')} style={actionBtnStyle('#ef4444')}>
                Junk
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              style={actionBtnStyle('#888')}
            >
              {expanded ? 'Close' : 'Edit Extraction'}
            </button>
            {comment.comment_date && (
              <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>
                {new Date(comment.comment_date).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Expanded extraction editor */}
          {expanded && (
            <div style={{
              marginTop: 10, padding: 12, background: '#0d0d14', borderRadius: 6,
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8,
            }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Contact name"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Address</label>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="1234 Main St"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>City</label>
                <input
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  placeholder="Cleveland"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <input
                  value={editState}
                  onChange={(e) => setEditState(e.target.value)}
                  placeholder="OH"
                  style={inputStyle}
                  maxLength={2}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  onClick={() => {
                    extract.mutate({
                      name: editName || undefined,
                      phone: editPhone || undefined,
                      address: editAddress || undefined,
                      city: editCity || undefined,
                      state: editState || undefined,
                    })
                    setExpanded(false)
                  }}
                  disabled={extract.isPending}
                  style={{
                    padding: '7px 14px', borderRadius: 5, border: 'none',
                    background: '#6366f1', color: '#fff', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', width: '100%',
                  }}
                >
                  {extract.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const actionBtnStyle = (color: string): React.CSSProperties => ({
  padding: '3px 10px', borderRadius: 4, border: `1px solid ${color}30`,
  background: 'transparent', color, cursor: 'pointer', fontSize: 11, fontWeight: 500,
})

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5,
  display: 'block', marginBottom: 3,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 4,
  border: '1px solid #2a2a3e', background: '#111118', color: '#ccc',
  fontSize: 12, boxSizing: 'border-box',
}

/* ── Campaigns View ────────────────────────────────────────── */

function CampaignsView() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['social-campaigns'],
    queryFn: hermesClient.socialBandit.campaigns.list,
  })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      hermesClient.socialBandit.campaigns.toggle(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-campaigns'] }),
  })

  if (isLoading) return <div style={{ color: '#666' }}>Loading campaigns...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#666' }}>
          Track your own ads and competitor ads to harvest comments from.
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '6px 14px', borderRadius: 5, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {showCreate ? 'Cancel' : '+ Add Campaign'}
        </button>
      </div>

      {showCreate && <CreateCampaignForm onDone={() => setShowCreate(false)} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {(campaigns || []).map((c) => (
          <div key={c.id} style={{
            background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 16,
            opacity: c.active ? 1 : 0.5,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600 }}>{c.campaign_name}</span>
              <button
                onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                style={{
                  padding: '3px 8px', borderRadius: 3, border: 'none',
                  background: c.active ? '#22c55e20' : '#ef444420',
                  color: c.active ? '#22c55e' : '#ef4444',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                }}
              >
                {c.active ? 'Active' : 'Paused'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              {c.platform} &middot; {c.post_type.replace('_', ' ')} &middot; {c.target_market}
            </div>
            <div style={{ fontSize: 11, color: '#444', marginBottom: 8, wordBreak: 'break-all' }}>
              {c.post_url}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ color: '#888' }}>{c.total_comments} comments</span>
              <span style={{ color: '#22c55e' }}>{c.qualified_comments} qualified</span>
              {c.last_scraped_at && (
                <span style={{ color: '#555' }}>Last: {new Date(c.last_scraped_at).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {campaigns && campaigns.length === 0 && (
        <div style={{ color: '#555', fontSize: 13, padding: 24, textAlign: 'center' }}>
          No campaigns yet. Add your Facebook/Instagram ad URLs or competitor ad URLs to track.
        </div>
      )}
    </div>
  )
}

/* ── Create Campaign Form ──────────────────────────────────── */

function CreateCampaignForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState('facebook')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [postType, setPostType] = useState('own_ad')
  const [market, setMarket] = useState('')

  const create = useMutation({
    mutationFn: () => hermesClient.socialBandit.campaigns.create({
      platform, campaign_name: name, post_url: url, post_type: postType, target_market: market,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-campaigns'] })
      onDone()
    },
  })

  return (
    <div style={{
      background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8,
      padding: 16, marginBottom: 16,
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10,
    }}>
      <div>
        <label style={labelStyle}>Platform</label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="craigslist">Craigslist</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Campaign Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CLE Cash Buyer Ad #1" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Post URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://facebook.com/..." style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Post Type</label>
        <select value={postType} onChange={(e) => setPostType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="own_ad">Your Ad</option>
          <option value="competitor_ad">Competitor Ad</option>
          <option value="community_post">Community Post</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Target Market</label>
        <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Cleveland OH" style={inputStyle} />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !name || !url}
          style={{
            padding: '7px 14px', borderRadius: 5, border: 'none',
            background: create.isPending ? '#333' : '#6366f1',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%',
          }}
        >
          {create.isPending ? 'Creating...' : 'Create Campaign'}
        </button>
      </div>
    </div>
  )
}

/* ── Import View ───────────────────────────────────────────── */

function ImportView() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState('facebook')
  const [postUrl, setPostUrl] = useState('')
  const [postType, setPostType] = useState('own_ad')
  const [market, setMarket] = useState('')
  const [rawText, setRawText] = useState('')
  const [result, setResult] = useState<{ imported: number; campaign_id: number } | null>(null)

  const importComments = useMutation({
    mutationFn: () => {
      const comments = parseRawComments(rawText)
      return hermesClient.socialBandit.importComments({
        platform, post_url: postUrl, post_type: postType, target_market: market, comments,
      })
    },
    onSuccess: (data) => {
      setResult(data)
      setRawText('')
      queryClient.invalidateQueries({ queryKey: ['social-comments'] })
      queryClient.invalidateQueries({ queryKey: ['social-campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['social-bandit-stats'] })
    },
  })

  return (
    <div>
      <div style={{
        background: '#111118', border: '1px solid #1e1e2e', borderRadius: 10, padding: 20,
      }}>
        <h3 style={{ color: '#e0e0e0', fontSize: 16, margin: '0 0 6px 0' }}>Import Comments</h3>
        <p style={{ color: '#666', fontSize: 12, margin: '0 0 16px 0', lineHeight: 1.6 }}>
          Paste comments from Facebook/Instagram ads. Each comment should be on its own line.
          Use "Name: comment text" format, or just paste the comment text.
          The system will auto-extract phone numbers, addresses, and names.
        </p>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10, marginBottom: 14,
        }}>
          <div>
            <label style={labelStyle}>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
              <option value="craigslist">Craigslist</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Post URL</label>
            <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://facebook.com/..." style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Post Type</label>
            <select value={postType} onChange={(e) => setPostType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="own_ad">Your Ad</option>
              <option value="competitor_ad">Competitor Ad</option>
              <option value="community_post">Community Post</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Target Market</label>
            <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Cleveland OH" style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Comments (one per line)</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`John Smith: My neighbor at 1234 Elm St needs to sell, call (216) 555-0123
Jane Doe: @mike_jones check this out for your Cleveland house
Bob Wilson: I have a property on Oak Ave I need gone ASAP`}
            style={{
              ...inputStyle,
              minHeight: 180,
              resize: 'vertical',
              fontFamily: 'monospace',
              lineHeight: 1.6,
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => importComments.mutate()}
            disabled={importComments.isPending || !rawText.trim() || !postUrl.trim()}
            style={{
              padding: '10px 24px', borderRadius: 6, border: 'none',
              background: importComments.isPending ? '#333' : '#6366f1',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {importComments.isPending ? 'Importing...' : `Import ${parseRawComments(rawText).length} Comments`}
          </button>

          {result && (
            <span style={{ color: '#22c55e', fontSize: 13 }}>
              Imported {result.imported} comments (auto-extracted contact info where found)
            </span>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div style={{
        marginTop: 20, background: '#111118', border: '1px solid #1e1e2e',
        borderRadius: 10, padding: 20,
      }}>
        <h3 style={{ color: '#e0e0e0', fontSize: 16, margin: '0 0 12px 0' }}>How This Works</h3>
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.8 }}>
          <p style={{ margin: '0 0 12px 0' }}>
            <strong style={{ color: '#ccc' }}>1. Run ads in your target markets.</strong> Post "We buy houses in [City]"
            style ads on Facebook/Instagram. Keep them broad -- you want comments, not clicks.
          </p>
          <p style={{ margin: '0 0 12px 0' }}>
            <strong style={{ color: '#ccc' }}>2. Find competitor ads.</strong> Search for "we buy houses" in your target markets.
            When competitors run ads, their comment sections fill with people tagging friends who need to sell,
            dropping addresses, and sharing phone numbers. These are free leads.
          </p>
          <p style={{ margin: '0 0 12px 0' }}>
            <strong style={{ color: '#ccc' }}>3. Harvest comments.</strong> Copy/paste comments from ad posts here.
            The system auto-extracts phone numbers, addresses, @mentions, and city names.
          </p>
          <p style={{ margin: '0 0 12px 0' }}>
            <strong style={{ color: '#ccc' }}>4. Review and qualify.</strong> In the Comment Inbox, review each comment.
            Mark good leads as "Qualified" and noise as "Junk". Edit the extracted info if the auto-parser missed something.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#ccc' }}>5. Ingest to pipeline.</strong> Push qualified comments into the lead pipeline.
            They become leads with source "social_bandit" and distress signal "social_media_comment".
            From there, skip trace for phone numbers and add to your call queue.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ───────────────────────────────────────────────── */

function parseRawComments(text: string): { commenter_name: string; comment_text: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Try "Name: comment" format
      const colonMatch = line.match(/^([^:]{2,40}):\s+(.+)$/)
      if (colonMatch) {
        return { commenter_name: colonMatch[1].trim(), comment_text: colonMatch[2].trim() }
      }
      return { commenter_name: 'Unknown', comment_text: line }
    })
}
