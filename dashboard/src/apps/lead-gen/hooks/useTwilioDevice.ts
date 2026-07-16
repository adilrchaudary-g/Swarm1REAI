import { useState, useCallback, useRef, useEffect } from 'react'
import { Device, Call } from '@twilio/voice-sdk'
import { hermesClient } from '../../../api/hermes-client'

export type CallStatus = 'ready' | 'connecting' | 'ringing' | 'connected' | 'ended'

export interface TwilioDeviceState {
  isReady: boolean
  isInitializing: boolean
  isMockMode: boolean
  error: string | null
  callStatus: CallStatus
  isMuted: boolean
  elapsedSeconds: number
  callDurationAtEnd: number | null
  makeCall: (phoneNumber: string) => void
  hangUp: () => void
  toggleMute: () => void
  initialize: () => Promise<void>
  destroy: () => void
  // Auto-dialer: join/leave the server-driven session conference (audio leg only).
  isSessionActive: boolean
  joinSession: () => void
  leaveSession: () => void
  // Power dialer: arm/disarm auto-accept of the server-initiated conference call.
  armPowerDialer: () => void
  disarmPowerDialer: () => void
}

const RING_TIMEOUT_MS = 20_000

export function useTwilioDevice(): TwilioDeviceState {
  const [isReady, setIsReady] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [isMockMode, setIsMockMode] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [callStatus, setCallStatus] = useState<CallStatus>('ready')
  const [isMuted, setIsMuted] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [callDurationAtEnd, setCallDurationAtEnd] = useState<number | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callStartRef = useRef<number | null>(null)
  const mockTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isSessionActive, setIsSessionActive] = useState(false)

  // Real-Twilio refs
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)
  const sessionCallRef = useRef<Call | null>(null)
  const incomingCallRef = useRef<Call | null>(null)
  const acceptIncomingRef = useRef(false)
  const initStartedRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    mockTimeoutsRef.current.forEach(clearTimeout)
    mockTimeoutsRef.current = []
    callStartRef.current = null
  }, [])

  const startTimer = useCallback(() => {
    callStartRef.current = Date.now()
    timerRef.current = setInterval(() => {
      if (callStartRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - callStartRef.current) / 1000))
      }
    }, 1000)
  }, [])

  const endCall = useCallback(() => {
    const duration = callStartRef.current ? Math.floor((Date.now() - callStartRef.current) / 1000) : 0
    setCallDurationAtEnd(duration)
    clearTimers()
    setCallStatus('ended')
    setIsMuted(false)
    callRef.current = null
  }, [clearTimers])

  const initialize = useCallback(async () => {
    if (initStartedRef.current) return   // guard against double-init (mount + mode switch)
    initStartedRef.current = true
    setIsInitializing(true)
    setError(null)
    try {
      const status = await hermesClient.twilio.status()
      if (!status.configured) {
        // Credentials/TwiML App not fully set up yet — run the UI simulator.
        setIsMockMode(true)
        setIsReady(true)
        return
      }

      // Real Twilio: fetch a Voice access token and register a Device.
      const { token } = await hermesClient.twilio.getToken()
      const device = new Device(token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        logLevel: 'error',
      })

      device.on('registered', () => {
        setIsMockMode(false)
        setIsReady(true)
      })
      device.on('error', (err: { message?: string }) => {
        setError(err?.message || 'Twilio device error')
      })
      device.on('tokenWillExpire', async () => {
        try {
          const refreshed = await hermesClient.twilio.getToken()
          device.updateToken(refreshed.token)
        } catch {
          /* token refresh failed; next call will surface the error */
        }
      })

      // Power dialer: the SERVER rings this browser to seat the agent in their warm
      // conference (spec §7). Auto-accept only while a power-dialer session is armed.
      device.on('incoming', (call: Call) => {
        if (!acceptIncomingRef.current) { call.reject(); return }
        call.accept()
        incomingCallRef.current = call
        setIsSessionActive(true)
        call.on('disconnect', () => {
          incomingCallRef.current = null
          setIsSessionActive(false)
        })
        call.on('error', (err: { message?: string }) => setError(err?.message || 'Session audio error'))
      })

      deviceRef.current = device
      await device.register()
    } catch (err) {
      // Any failure (backend down, mic blocked, token error) → fall back to mock
      // so the dialer UI still functions rather than hard-failing.
      setError(err instanceof Error ? err.message : 'Twilio init failed — running in simulator mode')
      setIsMockMode(true)
      setIsReady(true)
    } finally {
      setIsInitializing(false)
    }
  }, [])

  const makeCall = useCallback((phoneNumber: string) => {
    if (!isReady) return
    setCallStatus('connecting')
    setElapsedSeconds(0)
    setCallDurationAtEnd(null)
    setIsMuted(false)
    setError(null)

    if (isMockMode) {
      const t1 = setTimeout(() => setCallStatus('ringing'), 800)
      const t2 = setTimeout(() => {
        setCallStatus('connected')
        startTimer()
      }, 2300)
      mockTimeoutsRef.current = [t1, t2]

      ringTimeoutRef.current = setTimeout(() => {
        if (callStartRef.current === null) {
          endCall()
        }
      }, RING_TIMEOUT_MS)
      return
    }

    const device = deviceRef.current
    if (!device) {
      setError('Twilio device not ready')
      setCallStatus('ready')
      return
    }

    device
      .connect({ params: { To: phoneNumber } })
      .then((call) => {
        callRef.current = call
        call.on('ringing', () => setCallStatus('ringing'))
        call.on('accept', () => {
          setCallStatus('connected')
          startTimer()
        })
        call.on('disconnect', () => endCall())
        call.on('cancel', () => endCall())
        call.on('reject', () => endCall())
        call.on('error', (err: { message?: string }) => {
          setError(err?.message || 'Call error')
          endCall()
        })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to place call')
        setCallStatus('ready')
      })
  }, [isReady, isMockMode, startTimer, endCall])

  const hangUp = useCallback(() => {
    if (callStatus === 'ready' || callStatus === 'ended') return
    if (isMockMode) {
      endCall()
      return
    }
    if (callRef.current) {
      callRef.current.disconnect()
    } else {
      deviceRef.current?.disconnectAll()
      endCall()
    }
  }, [callStatus, isMockMode, endCall])

  const toggleMute = useCallback(() => {
    if (callStatus !== 'connected') return
    setIsMuted((m) => {
      const next = !m
      if (!isMockMode && callRef.current) {
        callRef.current.mute(next)
      }
      return next
    })
  }, [callStatus, isMockMode])

  // Join the server-driven auto-dialer conference (the agent's persistent audio
  // leg). Leads the server bridges in will be heard here. No mock path — the
  // auto-dialer requires real Twilio.
  const joinSession = useCallback(() => {
    const device = deviceRef.current
    if (!device || isMockMode) {
      setError('Auto-dialer needs a live Twilio connection')
      return
    }
    if (sessionCallRef.current) return
    device
      .connect({ params: { Mode: 'session' } })
      .then((call) => {
        sessionCallRef.current = call
        setIsSessionActive(true)
        call.on('disconnect', () => {
          sessionCallRef.current = null
          setIsSessionActive(false)
        })
        call.on('error', (err: { message?: string }) => {
          setError(err?.message || 'Session audio error')
        })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to join session')
      })
  }, [isMockMode])

  const leaveSession = useCallback(() => {
    if (sessionCallRef.current) {
      try { sessionCallRef.current.disconnect() } catch { /* already gone */ }
      sessionCallRef.current = null
    }
    setIsSessionActive(false)
  }, [])

  // Power dialer: arm the browser to accept the server-initiated conference call.
  const armPowerDialer = useCallback(() => { acceptIncomingRef.current = true }, [])
  const disarmPowerDialer = useCallback(() => {
    acceptIncomingRef.current = false
    if (incomingCallRef.current) {
      try { incomingCallRef.current.disconnect() } catch { /* already gone */ }
      incomingCallRef.current = null
    }
    setIsSessionActive(false)
  }, [])

  const destroy = useCallback(() => {
    clearTimers()
    initStartedRef.current = false
    if (sessionCallRef.current) {
      try { sessionCallRef.current.disconnect() } catch { /* already gone */ }
      sessionCallRef.current = null
    }
    setIsSessionActive(false)
    if (callRef.current) {
      try { callRef.current.disconnect() } catch { /* already gone */ }
      callRef.current = null
    }
    if (deviceRef.current) {
      try { deviceRef.current.destroy() } catch { /* already gone */ }
      deviceRef.current = null
    }
    setCallStatus('ready')
    setIsReady(false)
    setIsMuted(false)
    setElapsedSeconds(0)
    setCallDurationAtEnd(null)
    setError(null)
  }, [clearTimers])

  useEffect(() => () => {
    clearTimers()
    if (callRef.current) { try { callRef.current.disconnect() } catch { /* noop */ } }
    if (deviceRef.current) { try { deviceRef.current.destroy() } catch { /* noop */ } }
  }, [clearTimers])

  return {
    isReady, isInitializing, isMockMode, error,
    callStatus, isMuted, elapsedSeconds, callDurationAtEnd,
    makeCall, hangUp, toggleMute, initialize, destroy,
    isSessionActive, joinSession, leaveSession,
    armPowerDialer, disarmPowerDialer,
  }
}
