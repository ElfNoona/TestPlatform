import { useEffect, useRef, useCallback, useState } from 'react'

export type ProctoringStatus = 'CONNECTING' | 'ACTIVE' | 'DEGRADED' | 'DISCONNECTED' | 'UNAVAILABLE'

interface ProctoringEvent {
  action: 'TAB_HIDDEN' | 'FOCUS_REGAINED' | 'COPY' | 'PASTE'
  sequenceNumber: number
  clientEventId: string
  metadata?: Record<string, unknown>
}

interface UseProctoringClientOptions {
  sessionId: string | null
  token: string | null
  proctoringServiceUrl?: string
  /** Called with the current status whenever it changes */
  onStatusChange?: (status: ProctoringStatus) => void
}

/**
 * useProctoringClient — manages WebSocket connection to the proctoring service
 * and exposes a `sendEvent` function used by ProctoringGuard.
 *
 * Telemetry only (browser events). Webcam snapshot pipeline is deferred.
 *
 * Behaviour:
 *  - On PROCTORING_DEGRADED from server: buffer events locally, switch to degraded mode.
 *  - On disconnect: buffer events and attempt reconnect with backoff.
 *  - On reconnect: flush buffered events in order.
 */
export function useProctoringClient({
  sessionId,
  token,
  proctoringServiceUrl,
  onStatusChange,
}: UseProctoringClientOptions) {
  const [status, setStatus] = useState<ProctoringStatus>(
    sessionId ? 'CONNECTING' : 'UNAVAILABLE'
  )
  const wsRef           = useRef<WebSocket | null>(null)
  const seqRef          = useRef(0)
  const bufferRef       = useRef<ProctoringEvent[]>([])
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCount  = useRef(0)
  const isMounted       = useRef(true)

  const updateStatus = useCallback((s: ProctoringStatus) => {
    if (!isMounted.current) return
    setStatus(s)
    onStatusChange?.(s)
  }, [onStatusChange])

  const flushBuffer = useCallback((ws: WebSocket) => {
    const pending = bufferRef.current.splice(0)
    for (const evt of pending) {
      try { ws.send(JSON.stringify({ type: 'ACTION', ...evt })) } catch { /* ignore */ }
    }
  }, [])

  const connect = useCallback(() => {
    if (!sessionId || !token) return

    const wsUrl = (proctoringServiceUrl ?? window.location.origin.replace(/^http/, 'ws'))
      + `/ws?sessionId=${sessionId}&token=${token}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectCount.current = 0
      updateStatus('ACTIVE')
      flushBuffer(ws)
    }

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string }
        if (msg.type === 'PROCTORING_DEGRADED') {
          updateStatus('DEGRADED')
        }
      } catch { /* ignore */ }
    }

    ws.onerror = () => {
      updateStatus('DEGRADED')
    }

    ws.onclose = () => {
      if (!isMounted.current) return
      updateStatus('DISCONNECTED')
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * 2 ** reconnectCount.current, 30_000)
      reconnectCount.current += 1
      reconnectTimer.current = setTimeout(() => {
        if (isMounted.current) connect()
      }, delay)
    }
  }, [sessionId, token, proctoringServiceUrl, updateStatus, flushBuffer])

  useEffect(() => {
    isMounted.current = true
    if (sessionId && token) connect()
    return () => {
      isMounted.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [sessionId, token]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * sendEvent — called by ProctoringGuard when a browser telemetry event fires.
   * If WS is open, sends immediately. Otherwise buffers for replay.
   */
  const sendEvent = useCallback(
    (action: ProctoringEvent['action'], metadata?: Record<string, unknown>) => {
      const evt: ProctoringEvent = {
        action,
        sequenceNumber: ++seqRef.current,
        clientEventId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        metadata,
      }
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ACTION', ...evt }))
          return
        } catch { /* fall through to buffer */ }
      }
      // Buffer for later
      bufferRef.current.push(evt)
    },
    []
  )

  return { status, sendEvent }
}
