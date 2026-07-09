import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../../api/hermes-client'
import type { CallScore, BattleScore, SellerMotivationGrade, SellerSentiment } from '../../../api/types'

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

type View = 'list' | 'detail' | 'upload' | 'session'

function scoreColor(s: CallScore | null): string {
  if (s === 'Strong') return '#22c55e'
  if (s === 'Average') return '#eab308'
  if (s === 'Needs Work') return '#ef4444'
  return '#666'
}

function sentimentColor(s: SellerSentiment | string | null): string {
  if (s === 'Hot') return '#ef4444'
  if (s === 'Warm') return '#f59e0b'
  if (s === 'Cold') return '#3b82f6'
  if (s === 'Dead') return '#666'
  return '#888'
}

function parseGrade<T>(val: string | null): T | null {
  if (!val) return null
  if (typeof val === 'object') return val as T
  try { return JSON.parse(val) } catch { return null }
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

export function CallRecordingsPanel() {
  const [view, setView] = useState<View>('list')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  return (
    <div>
      {view === 'list' && (
        <ListView
          onSelect={(id) => { setSelectedId(id); setView('detail') }}
          onUpload={() => setView('upload')}
          onSessionUpload={() => setView('session')}
        />
      )}
      {view === 'detail' && selectedId !== null && (
        <DetailView recordingId={selectedId} onBack={() => setView('list')} />
      )}
      {view === 'upload' && (
        <UploadView
          onBack={() => setView('list')}
          onCreated={(id) => { setSelectedId(id); setView('detail') }}
        />
      )}
      {view === 'session' && (
        <SessionUploadView onBack={() => setView('list')} />
      )}
    </div>
  )
}

/* ── Scrub Bar (native range input styled like Spotify) ──── */

function ScrubBar({ progress, duration, playing, onSeek, onScrubStart }: {
  progress: number; duration: number; playing: boolean; onSeek: (t: number) => void; onScrubStart?: () => void
}) {
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubVal, setScrubVal] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  const displayTime = scrubbing ? scrubVal : progress
  const pct = duration > 0 ? (displayTime / duration) * 100 : 0
  const color = playing ? '#22c55e' : '#6366f1'

  const timeFromX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !duration) return 0
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  const startScrub = () => {
    setScrubbing(true)
    onScrubStart?.()
  }

  useEffect(() => {
    if (!scrubbing) return
    const onMove = (e: MouseEvent) => {
      e.preventDefault()
      setScrubVal(timeFromX(e.clientX))
    }
    const onUp = (e: MouseEvent) => {
      const t = timeFromX(e.clientX)
      setScrubbing(false)
      setScrubVal(0)
      onSeek(t)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  })

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: '#475569', fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>
        {fmtTime(displayTime)}
      </span>
      <div
        ref={trackRef}
        style={{ flex: 1, height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        onMouseDown={(e) => {
          e.preventDefault()
          startScrub()
          setScrubVal(timeFromX(e.clientX))
        }}
      >
        <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', position: 'relative' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 2, background: color,
            transition: scrubbing ? 'none' : 'width 0.15s linear',
          }} />
          <div style={{
            position: 'absolute',
            left: `calc(${pct}% - 6px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: '#475569', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
        {fmtTime(duration)}
      </span>
    </div>
  )
}

/* ── Reactive Waveform (Web Audio API) ─────────────────────── */

function WaveformBar({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const barCount = 36

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const step = Math.floor(data.length / barCount)
        const barW = w / barCount - 2
        for (let i = 0; i < barCount; i++) {
          const val = data[i * step] / 255
          const barH = Math.max(h * 0.08, val * h)
          const x = i * (barW + 2) + 1
          const y = (h - barH) / 2
          const alpha = 0.4 + val * 0.6
          ctx.fillStyle = `rgba(34,197,94,${alpha})`
          ctx.beginPath()
          ctx.roundRect(x, y, barW, barH, 2)
          ctx.fill()
        }
      } else {
        const barW = w / barCount - 2
        for (let i = 0; i < barCount; i++) {
          const val = Math.sin((i / barCount) * Math.PI) * 0.25 + 0.08
          const barH = val * h
          const x = i * (barW + 2) + 1
          const y = (h - barH) / 2
          ctx.fillStyle = 'rgba(60,60,90,0.5)'
          ctx.beginPath()
          ctx.roundRect(x, y, barW, barH, 2)
          ctx.fill()
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={36}
      style={{ width: '100%', height: 36, display: 'block' }}
    />
  )
}

/* ── Speaker Avatar ────────────────────────────────────────── */

function SpeakerAvatar({ name, side, volume }: {
  name: string; side: 'left' | 'right'; volume: number
}) {
  const isAdil = side === 'left'
  const active = volume > 0.05
  const glowSize = 12 + volume * 24
  const glowColor = isAdil ? '#22c55e' : '#22c55e'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 90 }}>
      <div style={{
        width: 76, height: 76, borderRadius: '50%',
        overflow: 'hidden', position: 'relative',
        boxShadow: active ? `0 0 ${glowSize}px ${glowColor}50, 0 0 ${glowSize * 2}px ${glowColor}20` : 'none',
        border: `2px solid ${active ? '#22c55e' : 'rgba(255,255,255,0.08)'}`,
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        {isAdil ? (
          <img
            src="/adil-avatar.png"
            alt="Adil"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #2a2a3e, #3a3a5e)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="#666" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#666" />
            </svg>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{name}</div>
        <div style={{
          fontSize: 10, fontWeight: 600, marginTop: 2,
          color: active ? '#22c55e' : '#333',
          letterSpacing: 0.5,
          transition: 'color 0.15s',
        }}>
          {active ? '(speaking)' : ' '}
        </div>
      </div>
    </div>
  )
}

/* ── Call Visualization Hero ───────────────────────────────── */

function CallVisualization({ sellerName, audioUrl, transcript }: {
  sellerName: string; audioUrl: string | null; transcript: string | null
}) {
  const audioRef = useRef<HTMLVideoElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [volume, setVolume] = useState(0)
  const volRaf = useRef<number>(0)
  const scrubbingRef = useRef(false)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (!scrubbingRef.current) {
        setProgress(el.currentTime)
      }
      setDuration(el.duration || 0)
    }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onTime)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onTime)
    }
  }, [])

  useEffect(() => {
    if (!playing || !analyserRef.current) { setVolume(0); return }
    const an = analyserRef.current
    const buf = new Uint8Array(an.frequencyBinCount)
    const tick = () => {
      an.getByteFrequencyData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i]
      setVolume(sum / (buf.length * 255))
      volRaf.current = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(volRaf.current)
  }, [playing])

  const ensureAudioContext = () => {
    if (ctxRef.current || !audioRef.current) return
    const ctx = new AudioContext()
    const src = ctx.createMediaElementSource(audioRef.current)
    const an = ctx.createAnalyser()
    an.fftSize = 256
    an.smoothingTimeConstant = 0.7
    src.connect(an)
    an.connect(ctx.destination)
    ctxRef.current = ctx
    sourceRef.current = src
    analyserRef.current = an
    setAnalyser(an)
  }

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    ensureAudioContext()
    if (playing) el.pause()
    else el.play()
  }

  return (
    <div style={{
      padding: '32px 24px', borderRadius: 16,
      background: 'linear-gradient(180deg, #0c0c14 0%, #111118 100%)',
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: 20,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 24, marginBottom: 20,
      }}>
        <SpeakerAvatar name="Adil" side="left" volume={playing ? volume : 0} />

        <div style={{
          flex: 1, maxWidth: 360,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: '100%', padding: '8px 14px',
            borderRadius: 24, background: '#08080e',
            border: `1px solid ${playing ? '#22c55e25' : 'rgba(255,255,255,0.06)'}`,
            display: 'flex', alignItems: 'center', gap: 12,
            transition: 'border-color 0.3s',
          }}>
            <button
              onClick={togglePlay}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                border: 'none',
                background: playing ? '#22c55e' : '#6366f1',
                color: '#fff',
                cursor: audioUrl ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, flexShrink: 0,
                opacity: audioUrl ? 1 : 0.3,
                transition: 'background 0.2s',
              }}
              disabled={!audioUrl}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <div style={{ flex: 1 }}>
              <WaveformBar analyser={playing ? analyser : null} />
            </div>
          </div>

          {audioUrl && (
            <ScrubBar
              progress={progress}
              duration={duration}
              playing={playing}
              onScrubStart={() => { scrubbingRef.current = true }}
              onSeek={(t) => {
                scrubbingRef.current = false
                if (audioRef.current) audioRef.current.currentTime = t
              }}
            />
          )}
        </div>

        <SpeakerAvatar name={sellerName} side="right" volume={playing ? volume : 0} />
      </div>

      {transcript && (
        <div style={{
          padding: '10px 16px', borderRadius: 10,
          textAlign: 'center', maxHeight: 56, overflow: 'hidden',
        }}>
          <div style={{
            fontSize: 12, color: '#334155', fontStyle: 'italic',
            lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          }}>
            "{transcript.slice(0, 200)}{transcript.length > 200 ? '...' : ''}"
          </div>
        </div>
      )}

      {audioUrl && <video ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />}
    </div>
  )
}

/* ── List View ─────────────────────────────────────────────── */

function ListView({ onSelect, onUpload, onSessionUpload }: { onSelect: (id: number) => void; onUpload: () => void; onSessionUpload: () => void }) {
  const [search, setSearch] = useState('')
  const [scoreFilter, setScoreFilter] = useState('')
  const [motivationFilter, setMotivationFilter] = useState('')

  const { data: recordings, isLoading } = useQuery({
    queryKey: ['call-recordings', search, scoreFilter, motivationFilter],
    queryFn: () => hermesClient.callRecordings.list({
      search: search || undefined,
      score: scoreFilter || undefined,
      motivation: motivationFilter || undefined,
      limit: 200,
    }),
    refetchInterval: 10_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['call-recordings-stats'],
    queryFn: () => hermesClient.callRecordings.stats(),
    refetchInterval: 15_000,
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>Seller Call Recordings</h2>
          {stats && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              {stats.total} recordings · {stats.transcribed} transcribed · {stats.graded} graded
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSessionUpload}
            style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid #22c55e40',
              background: '#22c55e18', color: '#22c55e', fontSize: 13,
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            Upload Dialing Session
          </button>
          <button
            onClick={onUpload}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#6366f1', color: '#fff', fontSize: 13,
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            + Upload Recording
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search name, address, transcript..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
            color: '#e2e8f0', fontSize: 13, outline: 'none',
          }}
        />
        <select
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
            color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
          }}
        >
          <option value="">All Scores</option>
          <option value="Strong">Strong</option>
          <option value="Average">Average</option>
          <option value="Needs Work">Needs Work</option>
        </select>
        <select
          value={motivationFilter}
          onChange={(e) => setMotivationFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
            color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
          }}
        >
          <option value="">All Motivation</option>
          <option value="Hot">Hot</option>
          <option value="Warm">Warm</option>
          <option value="Cold">Cold</option>
          <option value="Dead">Dead</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ color: '#64748b', padding: 20 }}>Loading recordings...</div>
      ) : !recordings || recordings.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: '#475569',
          border: '1px dashed #2a2a3e', borderRadius: 14,
        }}>
          No recordings yet. Upload your first call recording to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...recordings].sort((a, b) => {
            const scoreRank = (s: string | null) => s === 'Strong' ? 3 : s === 'Average' ? 2 : s === 'Needs Work' ? 1 : 0
            const ra = scoreRank(a.call_score)
            const rb = scoreRank(b.call_score)
            if (ra !== rb) return rb - ra
            const g = (r: typeof a) => { const p = parseGrade<BattleScore>(r.my_performance_json); return p?.overall ?? p?.score ?? -1 }
            return g(b) - g(a)
          }).map((rec) => {
            const motivation = parseGrade<SellerMotivationGrade>(rec.seller_motivation_json)
            const perf = parseGrade<BattleScore>(rec.my_performance_json)
            return (
              <div
                key={rec.id}
                onClick={() => onSelect(rec.id)}
                style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#6366f140'
                  e.currentTarget.style.background = '#14141f'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }}
              >
                {/* Left: avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #2a2a3e, #3a3a5e)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${rec.call_score ? scoreColor(rec.call_score) + '60' : 'rgba(255,255,255,0.08)'}`,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" fill="#666" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#666" />
                  </svg>
                </div>

                {/* Center: info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                      {rec.seller_name}
                    </span>
                    <span style={{ fontSize: 11, color: '#475569' }}>·</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {rec.property_address || 'No address'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#475569' }}>
                    {formatDate(rec.call_date)}
                    {rec.next_action && <span> · {rec.next_action}</span>}
                  </div>
                </div>

                {/* Right: badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {rec.lead_id && (
                    <div style={{
                      padding: '4px 10px', borderRadius: 14,
                      background: 'rgba(16,185,129,0.08)',
                      border: '1px solid rgba(16,185,129,0.2)',
                      color: '#10b981', fontSize: 10, fontWeight: 700,
                    }} title="Linked to lead record">
                      LINKED
                    </div>
                  )}
                  {perf && (
                    <div style={{
                      padding: '4px 10px', borderRadius: 14,
                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
                      fontSize: 12, fontWeight: 700, color: (perf.overall ?? perf.score ?? 0) >= 7 ? '#22c55e' : (perf.overall ?? perf.score ?? 0) >= 5 ? '#eab308' : '#ef4444',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {perf.overall ?? perf.score ?? '?'}/10
                    </div>
                  )}
                  {rec.call_score && (
                    <div style={{
                      padding: '4px 12px', borderRadius: 14,
                      background: `${scoreColor(rec.call_score)}12`,
                      border: `1px solid ${scoreColor(rec.call_score)}30`,
                      color: scoreColor(rec.call_score),
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {rec.call_score}
                    </div>
                  )}
                  {motivation?.overall_sentiment && (
                    <div style={{
                      padding: '4px 12px', borderRadius: 14,
                      background: `${sentimentColor(motivation.overall_sentiment)}12`,
                      border: `1px solid ${sentimentColor(motivation.overall_sentiment)}30`,
                      color: sentimentColor(motivation.overall_sentiment),
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {motivation.overall_sentiment}
                    </div>
                  )}
                  {!rec.transcript && rec.file_path && (
                    <div style={{
                      padding: '4px 12px', borderRadius: 14,
                      background: '#f59e0b12', border: '1px solid #f59e0b30',
                      color: '#f59e0b', fontSize: 11, fontWeight: 600,
                    }}>
                      Processing
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Detail View ───────────────────────────────────────────── */

function DetailView({ recordingId, onBack }: { recordingId: number; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [editingAction, setEditingAction] = useState(false)
  const [actionVal, setActionVal] = useState('')
  const [actionDueVal, setActionDueVal] = useState('')

  const { data: rec, isLoading } = useQuery({
    queryKey: ['call-recording', recordingId],
    queryFn: () => hermesClient.callRecordings.get(recordingId),
    refetchInterval: 5_000,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      hermesClient.callRecordings.update(recordingId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-recording', recordingId] }),
  })

  const transcribeMutation = useMutation({
    mutationFn: () => hermesClient.callRecordings.transcribe(recordingId),
  })

  const deleteMutation = useMutation({
    mutationFn: () => hermesClient.callRecordings.delete(recordingId),
    onSuccess: onBack,
  })

  const autoLinkMutation = useMutation({
    mutationFn: () => hermesClient.callRecordings.autoLink(recordingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-recording', recordingId] }),
  })

  if (isLoading || !rec) {
    return <div style={{ color: '#64748b', padding: 40, textAlign: 'center' }}>Loading...</div>
  }

  const perf = parseGrade<BattleScore>(rec.my_performance_json)
  const motivation = parseGrade<SellerMotivationGrade>(rec.seller_motivation_json)

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
          }}
        >
          Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>{rec.seller_name}</h2>
            {rec.call_score && (
              <span style={{
                padding: '3px 12px', borderRadius: 14,
                background: `${scoreColor(rec.call_score)}15`,
                border: `1px solid ${scoreColor(rec.call_score)}30`,
                color: scoreColor(rec.call_score),
                fontSize: 11, fontWeight: 700,
              }}>
                {rec.call_score}
              </span>
            )}
            {motivation?.overall_sentiment && (
              <span style={{
                padding: '3px 12px', borderRadius: 14,
                background: `${sentimentColor(motivation.overall_sentiment)}15`,
                border: `1px solid ${sentimentColor(motivation.overall_sentiment)}30`,
                color: sentimentColor(motivation.overall_sentiment),
                fontSize: 11, fontWeight: 700,
              }}>
                {motivation.overall_sentiment} Seller
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
            {rec.property_address || 'No address'} · {formatDate(rec.call_date)}
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            {rec.lead_id ? (
              <span style={{
                padding: '2px 10px', borderRadius: 12,
                background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
                color: '#10b981', fontSize: 11, fontWeight: 600,
              }}>
                Linked to lead
              </span>
            ) : (
              <button
                onClick={() => autoLinkMutation.mutate()}
                disabled={autoLinkMutation.isPending}
                style={{
                  padding: '2px 10px', borderRadius: 12, cursor: 'pointer',
                  background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)',
                  color: '#a78bfa', fontSize: 11, fontWeight: 600,
                }}
              >
                {autoLinkMutation.isPending ? 'Searching...' : 'Link to lead'}
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => { if (confirm('Delete this recording?')) deleteMutation.mutate() }}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', color: '#475569', fontSize: 12, cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      {/* Call Visualization Hero */}
      <CallVisualization
        sellerName={rec.seller_name}
        audioUrl={rec.file_path ? hermesClient.callRecordings.audioUrl(rec.id) : null}
        transcript={rec.transcript}
      />

      {/* Action buttons (when no transcript yet) */}
      {rec.file_path && !rec.transcript && (
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          <button
            onClick={() => transcribeMutation.mutate()}
            disabled={transcribeMutation.isPending}
            style={{
              padding: '10px 28px', borderRadius: 14, border: 'none',
              background: '#6366f1', color: '#fff', fontSize: 13,
              cursor: 'pointer', fontWeight: 600,
              opacity: transcribeMutation.isPending ? 0.6 : 1,
            }}
          >
            {transcribeMutation.isPending ? 'Starting...' : 'Transcribe & Grade'}
          </button>
          {transcribeMutation.isSuccess && (
            <div style={{ color: '#22c55e', fontSize: 12, marginTop: 8 }}>
              Processing in background...
            </div>
          )}
        </div>
      )}

      {rec.transcript && !rec.my_performance_json && (
        <div style={{
          marginBottom: 16, textAlign: 'center', padding: '12px 20px',
          borderRadius: 12, background: 'rgba(234,179,8,0.06)',
          border: '1px solid rgba(234,179,8,0.15)',
        }}>
          <span style={{ color: '#eab308', fontSize: 12, fontWeight: 600 }}>
            Grading in progress...
          </span>
        </div>
      )}

      {/* Battle Score + Seller Motivation */}
      {(perf || motivation) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {perf && (
            <div style={{
              padding: 20, borderRadius: 12,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Battle Score
                </h3>
                <span style={{
                  padding: '4px 14px', borderRadius: 14,
                  background: (perf.overall ?? perf.score ?? 0) >= 7 ? '#22c55e15' : (perf.overall ?? perf.score ?? 0) >= 5 ? '#eab30815' : '#ef444415',
                  border: `1px solid ${(perf.overall ?? perf.score ?? 0) >= 7 ? '#22c55e30' : (perf.overall ?? perf.score ?? 0) >= 5 ? '#eab30830' : '#ef444430'}`,
                  color: (perf.overall ?? perf.score ?? 0) >= 7 ? '#22c55e' : (perf.overall ?? perf.score ?? 0) >= 5 ? '#eab308' : '#ef4444',
                  fontSize: 15, fontWeight: 700,
                }}>
                  {perf.overall ?? perf.score ?? '?'}/10
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {perf.objection_handling != null && <BattleDim label="Objection Handling" score={perf.objection_handling} notes={perf.objection_notes} />}
                {perf.conversation_control != null && <BattleDim label="Conversation Control" score={perf.conversation_control} notes={perf.control_notes} />}
                {perf.kept_on_phone != null && <BattleDim label="Kept on Phone" score={perf.kept_on_phone} notes={perf.phone_notes} />}
                {perf.stayed_grounded != null && <BattleDim label="Stayed Grounded" score={perf.stayed_grounded} notes={perf.grounded_notes} />}
              </div>
              {perf.summary && (
                <div style={{
                  marginTop: 14, padding: '10px 14px', borderRadius: 14,
                  background: 'rgba(0,0,0,0.3)', border: '1px solid #1a1a2e',
                  fontSize: 12, color: '#999', lineHeight: 1.6,
                }}>
                  {perf.summary}
                </div>
              )}
            </div>
          )}

          {motivation && (
            <div style={{
              padding: 20, borderRadius: 12,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Seller Motivation
                </h3>
                <span style={{
                  padding: '4px 14px', borderRadius: 14,
                  background: `${sentimentColor(motivation.overall_sentiment)}15`,
                  border: `1px solid ${sentimentColor(motivation.overall_sentiment)}30`,
                  color: sentimentColor(motivation.overall_sentiment),
                  fontSize: 12, fontWeight: 700,
                }}>
                  {motivation.overall_sentiment} · {motivation.motivation_level}/10
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <GradeRow label="Core reason" value={motivation.core_reason} />
              </div>
              {motivation.summary && (
                <div style={{
                  marginTop: 14, padding: '10px 14px', borderRadius: 14,
                  background: 'rgba(0,0,0,0.3)', border: '1px solid #1a1a2e',
                  fontSize: 12, color: '#999', lineHeight: 1.6,
                }}>
                  {motivation.summary}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Full Transcript */}
      {rec.transcript && (
        <div style={{
          padding: 20, marginBottom: 16, borderRadius: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 style={{
            margin: '0 0 14px', fontSize: 13, color: '#94a3b8',
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Full Transcript
          </h3>
          <div style={{
            maxHeight: 360, overflow: 'auto', padding: 16, borderRadius: 14,
            background: 'rgba(0,0,0,0.3)', border: '1px solid #1a1a2e',
            fontSize: 13, color: '#bbb', lineHeight: 1.8,
            whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          }}>
            {rec.transcript}
          </div>
        </div>
      )}

      {/* Bottom row: Next Action + Notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{
          padding: 20, borderRadius: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Next Action
            </h3>
            {!editingAction && (
              <button
                onClick={() => {
                  setActionVal(rec.next_action || '')
                  setActionDueVal(rec.next_action_due || '')
                  setEditingAction(true)
                }}
                style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer',
                }}
              >
                Edit
              </button>
            )}
          </div>
          {editingAction ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text" placeholder="Next action..."
                value={actionVal} onChange={(e) => setActionVal(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)',
                  color: '#e2e8f0', fontSize: 13, outline: 'none',
                }}
              />
              <input
                type="date" value={actionDueVal}
                onChange={(e) => setActionDueVal(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)',
                  color: '#e2e8f0', fontSize: 13, outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    updateMutation.mutate({ next_action: actionVal, next_action_due: actionDueVal })
                    setEditingAction(false)
                  }}
                  style={{
                    padding: '6px 14px', borderRadius: 5, border: 'none',
                    background: '#6366f1', color: '#fff', fontSize: 12, cursor: 'pointer',
                  }}
                >Save</button>
                <button
                  onClick={() => setEditingAction(false)}
                  style={{
                    padding: '6px 14px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)',
                    background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
                  }}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ color: '#cbd5e1', fontSize: 13 }}>{rec.next_action || 'No action set'}</div>
              {rec.next_action_due && (
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Due: {formatDate(rec.next_action_due)}</div>
              )}
            </div>
          )}
        </div>

        <div style={{
          padding: 20, borderRadius: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Notes
            </h3>
            {!editingNotes && (
              <button
                onClick={() => { setNotesVal(rec.notes || ''); setEditingNotes(true) }}
                style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer',
                }}
              >Edit</button>
            )}
          </div>
          {editingNotes ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={notesVal} onChange={(e) => setNotesVal(e.target.value)} rows={4}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)',
                  color: '#e2e8f0', fontSize: 13, outline: 'none',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { updateMutation.mutate({ notes: notesVal }); setEditingNotes(false) }}
                  style={{
                    padding: '6px 14px', borderRadius: 5, border: 'none',
                    background: '#6366f1', color: '#fff', fontSize: 12, cursor: 'pointer',
                  }}
                >Save</button>
                <button
                  onClick={() => setEditingNotes(false)}
                  style={{
                    padding: '6px 14px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)',
                    background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
                  }}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ color: '#cbd5e1', fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {rec.notes || 'No notes'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GradeRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#475569', marginBottom: 3, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>{value}</div>
    </div>
  )
}

function BattleDim({ label, score, notes }: { label: string; score: number; notes?: string }) {
  const color = score >= 7 ? '#22c55e' : score >= 5 ? '#eab308' : '#ef4444'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{score}/10</span>
      </div>
      <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: notes ? 4 : 0 }}>
        <div style={{ height: '100%', width: `${score * 10}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      {notes && <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.4 }}>{notes}</div>}
    </div>
  )
}

/* ── Upload View ───────────────────────────────────────────── */

function UploadView({ onBack, onCreated }: { onBack: () => void; onCreated: (id: number) => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sellerName, setSellerName] = useState('')
  const [propertyAddress, setPropertyAddress] = useState('')
  const [callDate, setCallDate] = useState(new Date().toISOString().slice(0, 10))
  const [nextAction, setNextAction] = useState('')
  const [nextActionDue, setNextActionDue] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!sellerName.trim()) { setError('Seller name is required'); return }
    setUploading(true)
    setError('')
    const fd = new FormData()
    fd.append('seller_name', sellerName)
    fd.append('property_address', propertyAddress)
    fd.append('call_date', callDate)
    if (nextAction) fd.append('next_action', nextAction)
    if (nextActionDue) fd.append('next_action_due', nextActionDue)
    if (notes) fd.append('notes', notes)
    const file = fileRef.current?.files?.[0]
    if (file) fd.append('file', file, file.name)
    try {
      const result = await hermesClient.callRecordings.create(fd)
      queryClient.invalidateQueries({ queryKey: ['call-recordings'] })
      queryClient.invalidateQueries({ queryKey: ['call-recordings-stats'] })
      onCreated(result.id)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const fieldStyle = {
    padding: '10px 14px', borderRadius: 14, width: '100%',
    border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)',
    color: '#e2e8f0', fontSize: 13, outline: 'none',
    boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
          }}
        >Back</button>
        <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>Upload Call Recording</h2>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 14,
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
          color: '#ef4444', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{
        padding: 24, borderRadius: 12,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Seller Name *</label>
          <input type="text" value={sellerName} onChange={(e) => setSellerName(e.target.value)}
            placeholder="John Smith" style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Property Address</label>
          <input type="text" value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)}
            placeholder="123 Main St, City, ST 12345" style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Date of Call</label>
          <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>
            Call Recording
          </label>
          <input ref={fileRef} type="file" accept=".mp3,.mp4,.m4a,.mov,.wav,.webm,audio/*,video/*"
            style={{ ...fieldStyle, cursor: 'pointer' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Next Action</label>
            <input type="text" value={nextAction} onChange={(e) => setNextAction(e.target.value)}
              placeholder="Follow up call" style={fieldStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Due Date</label>
            <input type="date" value={nextActionDue} onChange={(e) => setNextActionDue(e.target.value)} style={fieldStyle} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'block', fontWeight: 500 }}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="Any notes about this call..."
            style={{ ...fieldStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} />
        </div>

        <button onClick={handleSubmit} disabled={uploading}
          style={{
            padding: '12px 28px', borderRadius: 14, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 14,
            cursor: uploading ? 'not-allowed' : 'pointer',
            fontWeight: 600, opacity: uploading ? 0.6 : 1,
            marginTop: 4,
          }}
        >
          {uploading ? 'Uploading...' : 'Upload & Transcribe'}
        </button>
      </div>
    </div>
  )
}

function SessionUploadView({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ status: string; session_id: string; file: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queryClient = useQueryClient()

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('session_date', sessionDate)
      const res = await hermesClient.callRecordings.uploadSession(fd)
      setResult(res)
      queryClient.invalidateQueries({ queryKey: ['call-recordings'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', color: '#6366f1',
          cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0,
        }}
      >
        &larr; Back to recordings
      </button>

      <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#e2e8f0' }}>Upload Dialing Session</h2>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>
        Upload a full recording of your dialing session. It will be transcribed, split into individual calls,
        matched to leads, and each call will be graded automatically.
      </p>

      {result ? (
        <div style={{
          padding: 24, borderRadius: 14, background: '#0d2818',
          border: '1px solid #22c55e30',
        }}>
          <div style={{ fontSize: 16, color: '#22c55e', fontWeight: 600, marginBottom: 8 }}>
            Session Processing
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>
            <strong>{result.file}</strong> is being transcribed and split into individual calls.
            This takes a few minutes for a 30-minute session. Calls will appear in the recordings
            list as they're processed.
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 12 }}>
            Session ID: {result.session_id}
          </div>
          <button
            onClick={onBack}
            style={{
              marginTop: 16, padding: '10px 24px', borderRadius: 6, border: 'none',
              background: '#22c55e', color: '#fff', fontSize: 13,
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            Back to Recordings
          </button>
        </div>
      ) : (
        <div style={{
          padding: 24, borderRadius: 14,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Recording File
            </label>
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.mp4,.m4a,.wav,.mov,.webm,.ogg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ fontSize: 13, color: '#cbd5e1' }}
            />
            {file && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Session Date
            </label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 6, fontSize: 13,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
                color: '#cbd5e1',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 14px', borderRadius: 6, marginBottom: 12,
              background: '#1f0f0f', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12,
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            style={{
              padding: '12px 28px', borderRadius: 6, border: 'none',
              background: file && !uploading ? '#22c55e' : '#222',
              color: file && !uploading ? '#fff' : '#555',
              fontSize: 14, cursor: file && !uploading ? 'pointer' : 'default',
              fontWeight: 700,
            }}
          >
            {uploading ? 'Uploading & Processing...' : 'Process Dialing Session'}
          </button>
        </div>
      )}
    </div>
  )
}
