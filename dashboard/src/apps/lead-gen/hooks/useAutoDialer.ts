import { useState, useCallback, useRef, useEffect } from 'react'
import { useTwilioDevice, type CallStatus } from './useTwilioDevice'

export type DialerMode = 'manual' | 'auto'
export type AutoDialState = 'idle' | 'dialing' | 'waiting_disposition' | 'countdown' | 'paused'

export interface AutoDialerConfig {
  countdownSeconds?: number
}

export interface AutoDialerState {
  callStatus: CallStatus
  isMuted: boolean
  elapsedSeconds: number
  callDurationAtEnd: number | null
  twilioReady: boolean
  twilioInitializing: boolean
  twilioError: string | null
  isMockMode: boolean

  dialerMode: DialerMode
  autoDialState: AutoDialState
  countdownRemaining: number
  isPaused: boolean

  sessionStats: { calls: number; connected: number; totalSeconds: number; estimatedCost: number }

  // Server-driven session audio leg (agent's browser joins the conference)
  isSessionActive: boolean
  joinSession: () => void
  leaveSession: () => void
  // Spec power dialer: the server rings the browser to seat the warm agent
  armPowerDialer: () => void
  disarmPowerDialer: () => void

  setDialerMode: (mode: DialerMode) => void
  startCall: (phoneNumber: string) => void
  hangUp: () => void
  toggleMute: () => void
  togglePause: () => void
  skipCountdown: () => void
  onDispositionComplete: () => void
  cancelAutoAdvance: () => void
  onCallAnswered: () => void
}

const COST_PER_MINUTE = 0.013

export function useAutoDialer(config?: AutoDialerConfig): AutoDialerState {
  const countdownTotal = config?.countdownSeconds ?? 3
  const twilio = useTwilioDevice()

  const [dialerMode, setDialerModeRaw] = useState<DialerMode>('manual')
  const [autoDialState, setAutoDialState] = useState<AutoDialState>('idle')
  const [countdownRemaining, setCountdownRemaining] = useState(countdownTotal)
  const [isPaused, setIsPaused] = useState(false)
  const [sessionStats, setSessionStats] = useState({ calls: 0, connected: 0, totalSeconds: 0, estimatedCost: 0 })

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingDialRef = useRef<(() => void) | null>(null)
  const wasConnectedRef = useRef(false)

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }, [])

  const setDialerMode = useCallback((mode: DialerMode) => {
    // Twilio stays initialized for BOTH modes — browser calls are placed in
    // manual and auto alike, so we never tear the device down on a mode switch.
    if (mode === 'auto' && !twilio.isReady) {
      twilio.initialize()
    }
    clearCountdown()
    setAutoDialState('idle')
    setIsPaused(false)
    setDialerModeRaw(mode)
  }, [twilio, clearCountdown])

  // Initialize Twilio once on mount so the device registers immediately: this
  // un-locks the Auto toggle and lets manual calls fire without a mode switch.
  useEffect(() => {
    twilio.initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCall = useCallback((phoneNumber: string) => {
    clearCountdown()
    wasConnectedRef.current = false
    twilio.makeCall(phoneNumber)
    setAutoDialState('dialing')
    setSessionStats(s => ({ ...s, calls: s.calls + 1 }))
  }, [twilio, clearCountdown])

  const hangUp = useCallback(() => {
    twilio.hangUp()
  }, [twilio])

  const toggleMute = useCallback(() => {
    twilio.toggleMute()
  }, [twilio])

  const onCallAnswered = useCallback(() => {
    wasConnectedRef.current = true
    setSessionStats(s => ({ ...s, connected: s.connected + 1 }))
  }, [])

  useEffect(() => {
    if (twilio.callStatus === 'connected' && !wasConnectedRef.current) {
      onCallAnswered()
    }
  }, [twilio.callStatus, onCallAnswered])

  useEffect(() => {
    if (twilio.callStatus === 'ended' && autoDialState === 'dialing') {
      if (twilio.callDurationAtEnd !== null) {
        setSessionStats(s => ({
          ...s,
          totalSeconds: s.totalSeconds + twilio.callDurationAtEnd!,
          estimatedCost: (s.totalSeconds + twilio.callDurationAtEnd!) / 60 * COST_PER_MINUTE,
        }))
      }
      setAutoDialState('waiting_disposition')
    }
  }, [twilio.callStatus, twilio.callDurationAtEnd, autoDialState])

  const startCountdown = useCallback(() => {
    clearCountdown()
    setCountdownRemaining(countdownTotal)
    setAutoDialState('countdown')
    let remaining = countdownTotal
    countdownRef.current = setInterval(() => {
      remaining -= 1
      setCountdownRemaining(remaining)
      if (remaining <= 0) {
        clearCountdown()
        setAutoDialState('idle')
        pendingDialRef.current?.()
        pendingDialRef.current = null
      }
    }, 1000)
  }, [countdownTotal, clearCountdown])

  const onDispositionComplete = useCallback(() => {
    if (dialerMode !== 'auto' || isPaused) {
      setAutoDialState('idle')
      return
    }
    startCountdown()
  }, [dialerMode, isPaused, startCountdown])

  const skipCountdown = useCallback(() => {
    clearCountdown()
    setAutoDialState('idle')
    pendingDialRef.current?.()
    pendingDialRef.current = null
  }, [clearCountdown])

  const cancelAutoAdvance = useCallback(() => {
    clearCountdown()
    setAutoDialState('idle')
    pendingDialRef.current = null
  }, [clearCountdown])

  const togglePause = useCallback(() => {
    if (isPaused) {
      setIsPaused(false)
      if (autoDialState === 'paused') {
        setAutoDialState('idle')
      }
    } else {
      setIsPaused(true)
      if (autoDialState === 'countdown') {
        clearCountdown()
        setAutoDialState('paused')
      }
    }
  }, [isPaused, autoDialState, clearCountdown])

  useEffect(() => () => { clearCountdown() }, [clearCountdown])

  return {
    callStatus: twilio.callStatus,
    isMuted: twilio.isMuted,
    elapsedSeconds: twilio.elapsedSeconds,
    callDurationAtEnd: twilio.callDurationAtEnd,
    twilioReady: twilio.isReady,
    twilioInitializing: twilio.isInitializing,
    twilioError: twilio.error,
    isMockMode: twilio.isMockMode,

    // Server-driven auto-dialer session (audio leg)
    isSessionActive: twilio.isSessionActive,
    joinSession: twilio.joinSession,
    leaveSession: twilio.leaveSession,
    // Power dialer (server rings the browser to seat the agent)
    armPowerDialer: twilio.armPowerDialer,
    disarmPowerDialer: twilio.disarmPowerDialer,

    dialerMode,
    autoDialState,
    countdownRemaining,
    isPaused,
    sessionStats,

    setDialerMode,
    startCall,
    hangUp,
    toggleMute,
    togglePause,
    skipCountdown,
    onDispositionComplete,
    cancelAutoAdvance,
    onCallAnswered,
  }
}
