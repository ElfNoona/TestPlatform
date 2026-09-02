import { SocketMessage, ProctoringStatus } from './types'
import { EventBuffer } from './EventBuffer'

export class ProctoringSocket {
  private sessionId: string
  private token: string
  private proctoringOrigin: string
  private ws: WebSocket | null = null
  private eventBuffer: EventBuffer
  
  private reconnectCount: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private maxReconnectDelay: number = 30000
  private isConnecting: boolean = false
  private isExplicitlyClosed: boolean = false

  // Callbacks
  private onStatusChange: (status: ProctoringStatus) => void
  private onMessageReceived: (msg: SocketMessage) => void

  constructor(
    sessionId: string,
    token: string,
    proctoringOrigin: string,
    eventBuffer: EventBuffer,
    onStatusChange: (status: ProctoringStatus) => void,
    onMessageReceived: (msg: SocketMessage) => void
  ) {
    this.sessionId = sessionId
    this.token = token
    this.proctoringOrigin = proctoringOrigin
    this.eventBuffer = eventBuffer
    this.onStatusChange = onStatusChange
    this.onMessageReceived = onMessageReceived
  }

  public connect() {
    if (this.ws || this.isConnecting) return
    this.isConnecting = true
    this.isExplicitlyClosed = false

    this.onStatusChange('CONNECTING')

    // Determine ws:// or wss:// url
    const wsProto = this.proctoringOrigin.startsWith('https') ? 'wss' : 'ws'
    let host = 'localhost:7000'

    try {
      const originUrl = new URL(this.proctoringOrigin)
      host = originUrl.host
    } catch {
      // Fallback if parsing fails
      if (typeof window !== 'undefined') {
        const h = window.location.host
        host = h.includes(':') ? `${h.split(':')[0]}:7000` : `${h}:7000`
      }
    }

    const wsUrl = `${wsProto}://${host}/ws/proctoring/${this.sessionId}?token=${this.token}`
    console.log(`[ProctoringSocket] Connecting to: ${wsUrl}`)

    try {
      this.ws = new WebSocket(wsUrl)
      this.setupSocketEvents(this.ws)
    } catch (e) {
      console.error('[ProctoringSocket] Socket creation error:', e)
      this.isConnecting = false
      this.handleDisconnect()
    }
  }

  private setupSocketEvents(ws: WebSocket) {
    ws.onopen = () => {
      this.isConnecting = false
      this.reconnectCount = 0
      console.log('[ProctoringSocket] WebSocket connection established.')
      this.onStatusChange('ACTIVE')
      this.flushPendingBuffer()
    }

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as SocketMessage
        console.log('[ProctoringSocket] Received message:', msg)

        // Process standard event-level ACKs
        if (msg.event === 'ACK' && msg.clientEventId) {
          this.eventBuffer.ackEvent(msg.clientEventId)
        }

        // Forward to manager
        this.onMessageReceived(msg)
      } catch (err) {
        console.error('[ProctoringSocket] Error parsing socket message:', err)
      }
    }

    ws.onerror = (e) => {
      console.error('[ProctoringSocket] WebSocket error:', e)
    }

    ws.onclose = (e) => {
      console.log(`[ProctoringSocket] WebSocket closed. Code: ${e.code}, Reason: ${e.reason}`)
      this.ws = null
      this.isConnecting = false
      
      if (!this.isExplicitlyClosed) {
        this.handleDisconnect()
      }
    }
  }

  public send(data: object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data))
        return true
      } catch (e) {
        console.error('[ProctoringSocket] Send failed:', e)
      }
    }
    return false
  }

  private handleDisconnect() {
    this.onStatusChange('DISCONNECTED')
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectCount), this.maxReconnectDelay)
    this.reconnectCount++

    console.log(`[ProctoringSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})...`)
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private async flushPendingBuffer() {
    const pending = this.eventBuffer.getPendingEvents()
    if (pending.length === 0) return

    console.log(`[ProctoringSocket] Reconnection flush: sending ${pending.length} buffered events...`)

    // Spaced out flushing: 200ms interval to prevent rate-limiting and connection overload
    for (let i = 0; i < pending.length; i++) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.warn('[ProctoringSocket] Socket disconnected during flush. Aborting.')
        break
      }

      const evt = pending[i]
      this.send(evt)

      // Spacing delay
      if (i < pending.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
  }

  public disconnect() {
    this.isExplicitlyClosed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.reconnectCount = 0
  }
}
