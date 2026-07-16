import { Phone, PhoneCall, PhoneOff, Mic, MicOff, Pause, Play, Zap, SkipForward } from 'lucide-react'
import type { CallStatus } from '../hooks/useTwilioDevice'
import type { DialerMode } from '../hooks/useAutoDialer'

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// --- DialerModeToggle ---

interface DialerModeToggleProps {
  mode: DialerMode
  onToggle: (mode: DialerMode) => void
  twilioAvailable: boolean
}

export function DialerModeToggle({ mode, onToggle, twilioAvailable }: DialerModeToggleProps) {
  const segmentBase: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, fontWeight: 700,
    border: 'none', cursor: 'pointer', borderRadius: 5,
    transition: 'all 0.15s',
  }

  return (
    <div style={{
      display: 'inline-flex', gap: 2,
      background: '#0d0d14', border: '1px solid #1e1e2e',
      borderRadius: 7, padding: 2,
    }}>
      <button
        onClick={() => onToggle('manual')}
        style={{
          ...segmentBase,
          background: mode === 'manual' ? '#1e1e2e' : 'transparent',
          color: mode === 'manual' ? '#e2e8f0' : '#475569',
        }}
      >
        Manual
      </button>
      <button
        onClick={() => twilioAvailable && onToggle('auto')}
        disabled={!twilioAvailable && mode !== 'auto'}
        style={{
          ...segmentBase,
          background: mode === 'auto' ? '#6366f120' : 'transparent',
          color: mode === 'auto' ? '#a5b4fc' : (twilioAvailable ? '#475569' : '#27272e'),
          cursor: !twilioAvailable && mode !== 'auto' ? 'not-allowed' : 'pointer',
        }}
        title={!twilioAvailable ? 'Twilio not configured' : undefined}
      >
        <Zap size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
        Auto
      </button>
    </div>
  )
}

// --- CallStatusBar ---

interface CallStatusBarProps {
  callStatus: CallStatus
  elapsedSeconds: number
  isMuted: boolean
  isMockMode: boolean
  onMute: () => void
  onHangUp: () => void
  leadName: string | null
  leadAddress: string | null
  phoneNumber: string | null
  isMobile: boolean
}

const STATUS_CONFIG: Record<CallStatus, { label: string; color: string; borderColor: string; animate: boolean }> = {
  ready: { label: '', color: '#64748b', borderColor: '#1e1e2e', animate: false },
  connecting: { label: 'Connecting...', color: '#6366f1', borderColor: '#6366f130', animate: true },
  ringing: { label: 'Ringing...', color: '#818cf8', borderColor: '#6366f140', animate: true },
  connected: { label: 'Connected', color: '#22c55e', borderColor: '#22c55e40', animate: false },
  ended: { label: 'Call Ended', color: '#64748b', borderColor: '#1e1e2e', animate: false },
}

export function CallStatusBar({
  callStatus, elapsedSeconds, isMuted, isMockMode,
  onMute, onHangUp, leadName, leadAddress, phoneNumber, isMobile,
}: CallStatusBarProps) {
  if (callStatus === 'ready') return null

  const cfg = STATUS_CONFIG[callStatus]
  const isActive = callStatus === 'connecting' || callStatus === 'ringing' || callStatus === 'connected'

  return (
    <div style={{
      background: '#0d0d14',
      border: `1px solid ${cfg.borderColor}`,
      borderRadius: 10, padding: isMobile ? '12px 14px' : '10px 14px',
      marginBottom: 12,
      transition: 'border-color 0.3s',
    }}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Status dot + icon */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          flex: 1, minWidth: 0,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: cfg.color,
            animation: cfg.animate ? 'statusPulse 1.5s infinite' : 'none',
            flexShrink: 0,
          }} />
          {callStatus === 'connected' ? (
            <PhoneCall size={14} color={cfg.color} />
          ) : callStatus === 'ended' ? (
            <PhoneOff size={14} color={cfg.color} />
          ) : (
            <Phone size={14} color={cfg.color} />
          )}
          <span style={{ color: cfg.color, fontSize: 12, fontWeight: 700 }}>
            {cfg.label}
          </span>
          {callStatus === 'connected' && (
            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
              {formatTime(elapsedSeconds)}
            </span>
          )}
          {isMockMode && (
            <span style={{
              background: '#261f11', color: '#eab308',
              padding: '1px 6px', borderRadius: 4,
              fontSize: 10, fontWeight: 700,
            }}>
              MOCK
            </span>
          )}
        </div>

        {/* Controls */}
        {isActive && (
          <div style={{ display: 'flex', gap: 6 }}>
            {callStatus === 'connected' && (
              <button
                onClick={onMute}
                style={{
                  ...btn,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: '50%',
                  background: isMuted ? '#ef444420' : '#1e1e2e',
                  color: isMuted ? '#ef4444' : '#94a3b8',
                }}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
            )}
            <button
              onClick={onHangUp}
              style={{
                ...btn,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: '50%',
                background: '#ef4444', color: '#fff',
              }}
              title="Hang Up"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Caller context — name + address always visible */}
      {(leadName || leadAddress) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1a1a28' }}>
          {leadName && (
            <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
              {leadName}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {leadAddress && (
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{leadAddress}</span>
            )}
            {phoneNumber && (
              <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>{phoneNumber}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// --- AutoAdvanceCountdown ---

interface AutoAdvanceCountdownProps {
  secondsRemaining: number
  totalSeconds: number
  onSkip: () => void
  onPause: () => void
  nextLeadName: string | null
}

export function AutoAdvanceCountdown({
  secondsRemaining, totalSeconds, onSkip, onPause, nextLeadName,
}: AutoAdvanceCountdownProps) {
  const progress = totalSeconds > 0 ? (secondsRemaining / totalSeconds) * 100 : 0

  return (
    <div style={{
      background: '#0d0d1a', border: '1px solid #6366f120',
      borderRadius: 10, padding: '10px 14px', marginTop: 10,
    }}>
      {/* Progress bar */}
      <div style={{ height: 3, background: '#16162a', borderRadius: 2, marginBottom: 8 }}>
        <div style={{
          height: '100%', background: '#6366f1', borderRadius: 2,
          width: `${progress}%`, transition: 'width 1s linear',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 600 }}>
            Next{nextLeadName ? `: ${nextLeadName}` : ' lead'} in {secondsRemaining}s
          </span>
        </div>
        <button
          onClick={onSkip}
          style={{
            ...btn, display: 'flex', alignItems: 'center', gap: 4,
            background: '#6366f120', color: '#a5b4fc',
            padding: '5px 10px', fontSize: 11,
          }}
        >
          <SkipForward size={11} />
          Dial Now
        </button>
        <button
          onClick={onPause}
          style={{
            ...btn, display: 'flex', alignItems: 'center', gap: 4,
            background: '#1e1e2e', color: '#94a3b8',
            padding: '5px 10px', fontSize: 11,
          }}
        >
          <Pause size={11} />
          Pause
        </button>
      </div>
    </div>
  )
}

// --- AutoDialPauseResume ---

interface AutoDialPauseResumeProps {
  isPaused: boolean
  onToggle: () => void
  queuePosition: number
  queueTotal: number
}

export function AutoDialPauseResume({ isPaused, onToggle, queuePosition, queueTotal }: AutoDialPauseResumeProps) {
  return (
    <button
      onClick={onToggle}
      style={{
        ...btn,
        display: 'flex', alignItems: 'center', gap: 5,
        background: isPaused ? '#261f11' : '#0d211c',
        border: `1px solid ${isPaused ? '#3d2f11' : '#1a3d2a'}`,
        borderRadius: 6, padding: '5px 10px',
        color: isPaused ? '#eab308' : '#22c55e',
        fontSize: 11, fontWeight: 700,
      }}
      title={isPaused ? 'Resume auto-dialing' : 'Pause auto-dialing'}
    >
      {isPaused ? <Play size={11} /> : <Pause size={11} />}
      {isPaused ? 'Resume' : 'Active'}
      <span style={{ color: '#64748b', fontWeight: 600 }}>
        {queuePosition}/{queueTotal}
      </span>
    </button>
  )
}

// --- SessionCostBar ---

interface SessionCostBarProps {
  calls: number
  connected: number
  totalSeconds: number
  estimatedCost: number
}

export function SessionCostBar({ calls, connected, totalSeconds, estimatedCost }: SessionCostBarProps) {
  if (calls === 0) return null

  return (
    <div style={{
      display: 'flex', gap: 14, fontSize: 11, color: '#64748b',
      padding: '6px 0', borderTop: '1px solid #1a1a28', marginTop: 8,
    }}>
      <span><span style={{ color: '#94a3b8', fontWeight: 600 }}>{calls}</span> dials</span>
      <span><span style={{ color: '#22c55e', fontWeight: 600 }}>{connected}</span> connected</span>
      <span>{formatTime(totalSeconds)} talk time</span>
      <span style={{ marginLeft: 'auto', color: '#eab308', fontWeight: 600 }}>
        ~${estimatedCost.toFixed(2)}
      </span>
    </div>
  )
}
