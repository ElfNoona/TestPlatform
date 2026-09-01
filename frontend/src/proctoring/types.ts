export type ProctoringStatus = 'CONNECTING' | 'ACTIVE' | 'DEGRADED' | 'DISCONNECTED' | 'UNAVAILABLE'

export interface ProctoringEvent {
  clientEventId: string
  type: string
  clientTimestamp: string // ISO string
  durationMs: number
  sequenceNumber: number
  metadata?: Record<string, any>
}

export type ProctoringSocketState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'

export interface SocketMessage {
  event: 'CONNECTED' | 'ACK' | 'HEARTBEAT_ACK' | 'ERROR' | 'CONNECTION_WARNING' | 'CONNECTION_RESTORED'
  sessionId?: string
  clientEventId?: string
  sequenceNumber?: number
  duplicate?: boolean
  status?: string
  code?: string
  reason?: string
  details?: any
}
