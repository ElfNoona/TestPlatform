import { ProctoringStatus, ProctoringEvent, SocketMessage } from './types'
import { EventBuffer } from './EventBuffer'
import { HeartbeatManager } from './HeartbeatManager'
import { ProctoringMediaManager } from './ProctoringMediaManager'
import { ProctoringSocket } from './ProctoringSocket'

interface ProctoringManagerConfig {
  sessionId: string
  token: string
  proctoringOrigin?: string
  onStatusChange: (status: ProctoringStatus) => void
  onCameraStatusChange?: (active: boolean) => void
  onUploadStatusChange?: (status: 'idle' | 'uploading' | 'completed' | 'error') => void
}

export class ProctoringManager {
  private proctoringOrigin: string
  
  private status: ProctoringStatus = 'CONNECTING'

  private socket: ProctoringSocket
  private eventBuffer: EventBuffer
  private heartbeat: HeartbeatManager
  private media: ProctoringMediaManager

  private onStatusChangeCallback: (status: ProctoringStatus) => void
  private onCameraStatusChangeCallback?: (active: boolean) => void
  private onUploadStatusChangeCallback?: (status: 'idle' | 'uploading' | 'completed' | 'error') => void

  private activeListeners: Record<string, EventListener> = {}

  constructor(config: ProctoringManagerConfig) {
    this.proctoringOrigin = config.proctoringOrigin || window.location.origin
    
    this.onStatusChangeCallback = config.onStatusChange
    this.onCameraStatusChangeCallback = config.onCameraStatusChange
    this.onUploadStatusChangeCallback = config.onUploadStatusChange

    // 1. Initialize EventBuffer
    this.eventBuffer = new EventBuffer(config.sessionId)

    // 2. Initialize HeartbeatManager
    this.heartbeat = new HeartbeatManager({
      getNext: () => this.eventBuffer.getNextSequenceNumber()
    })

    // 3. Initialize ProctoringMediaManager
    this.media = new ProctoringMediaManager(
      config.sessionId,
      config.token,
      this.proctoringOrigin
    )

    this.media.registerCallbacks(
      (status) => {
        this.onUploadStatusChangeCallback?.(status)
      },
      (active) => {
        this.onCameraStatusChangeCallback?.(active)
      }
    )

    // 4. Initialize ProctoringSocket
    this.socket = new ProctoringSocket(
      config.sessionId,
      config.token,
      this.proctoringOrigin,
      this.eventBuffer,
      (status) => this.handleSocketStatusChange(status),
      (msg) => this.handleSocketMessage(msg)
    )
  }

  public async start() {
    console.log('[ProctoringManager] Starting proctoring subsystem...')
    
    // 1. Start Websocket Connection
    this.socket.connect()

    // 2. Initialize Camera and Start snapshots
    const cameraSuccess = await this.media.initializeCamera()
    if (cameraSuccess) {
      this.media.startSnapshotCycle()
      this.sendTelemetry('CAMERA_STARTED', { info: 'Webcam stream initialized' })
    } else {
      this.sendTelemetry('CAMERA_PERMISSION_DENIED', { info: 'Failed to access camera stream' })
    }

    // 3. Start Heartbeats
    this.heartbeat.start((seqNum, clientEventId) => {
      this.socket.send({
        clientEventId,
        type: 'HEARTBEAT',
        clientTimestamp: new Date().toISOString(),
        durationMs: 0,
        sequenceNumber: seqNum,
        metadata: {}
      })
    })

    // 4. Bind browser telemetry
    this.bindBrowserTelemetry()
  }

  public stop() {
    console.log('[ProctoringManager] Stopping proctoring subsystem...')
    this.unbindBrowserTelemetry()
    this.heartbeat.stop()
    this.media.stopCamera()
    this.socket.disconnect()
  }

  public getMediaStream(): MediaStream | null {
    return this.media.getStream()
  }

  private handleSocketStatusChange(socketStatus: ProctoringStatus) {
    if (socketStatus === 'ACTIVE') {
      // Reconnected or connected
      this.setStatus('ACTIVE')
    } else if (socketStatus === 'DISCONNECTED') {
      // Degrade state immediately to warn candidate events are buffered locally
      this.setStatus('DEGRADED')
    } else {
      this.setStatus(socketStatus)
    }
  }

  private handleSocketMessage(msg: SocketMessage) {
    if (msg.event === 'HEARTBEAT_ACK' && msg.sequenceNumber !== undefined) {
      this.heartbeat.onHeartbeatAck(msg.sequenceNumber)
      
      // If we were degraded due to heartbeat loss or Redis, restore status to ACTIVE
      if (this.status === 'DEGRADED') {
        this.setStatus('ACTIVE')
      }
    }

    if (msg.event === 'ERROR') {
      console.warn('[ProctoringManager] Server reported error:', msg.reason)
      if (msg.code === 'PROCTORING_DEGRADED') {
        this.setStatus('DEGRADED')
      }
    }

    if (msg.event === 'CONNECTION_WARNING') {
      this.setStatus('DEGRADED')
    }

    if (msg.event === 'CONNECTION_RESTORED') {
      this.setStatus('ACTIVE')
    }
  }

  private setStatus(newStatus: ProctoringStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus
      this.onStatusChangeCallback(newStatus)
    }
  }

  /**
   * Generates and dispatches a telemetry event.
   */
  public sendTelemetry(eventType: string, metadata: Record<string, any> = {}) {
    const sequenceNumber = this.eventBuffer.getNextSequenceNumber()
    const clientEventId = `evt_${eventType.toLowerCase()}_${sequenceNumber}_${Date.now()}`
    
    const event: ProctoringEvent = {
      clientEventId,
      type: eventType,
      clientTimestamp: new Date().toISOString(),
      durationMs: 0,
      sequenceNumber,
      metadata
    }

    console.log(`[ProctoringManager] Queueing event: ${eventType} (#${sequenceNumber})`)
    this.eventBuffer.addEvent(event)

    // Attempt direct send over WebSocket
    this.socket.send(event)
    
    // Trigger snapshot capture for critical violation events
    const criticalEvents = ['TAB_HIDDEN', 'FULLSCREEN_EXITED', 'CAMERA_STOPPED', 'SCREEN_SHARE_STOPPED']
    if (criticalEvents.includes(eventType)) {
      this.media.captureSnapshot('EVENT_SNAPSHOT', clientEventId)
    }
  }

  /**
   * Captures the final snapshot when the user submits their exam attempt.
   */
  public async captureFinalSnapshot(): Promise<boolean> {
    console.log('[ProctoringManager] Capturing final evidence snapshot...')
    return this.media.captureSnapshot('FINAL_SNAPSHOT')
  }

  private bindBrowserTelemetry() {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        this.sendTelemetry('TAB_HIDDEN', { path: window.location.pathname })
      } else {
        this.sendTelemetry('TAB_VISIBLE', { path: window.location.pathname })
      }
    }

    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement
      if (isFullscreen) {
        this.sendTelemetry('FULLSCREEN_ENTERED')
      } else {
        this.sendTelemetry('FULLSCREEN_EXITED')
      }
    }

    const handleCopy = () => {
      this.sendTelemetry('COPY')
    }

    const handlePaste = () => {
      this.sendTelemetry('PASTE')
    }

    const handleBlur = () => {
      this.sendTelemetry('WINDOW_BLUR')
    }

    const handleFocus = () => {
      this.sendTelemetry('WINDOW_FOCUS')
    }

    this.activeListeners = {
      visibilitychange: handleVisibilityChange,
      fullscreenchange: handleFullscreenChange,
      copy: handleCopy,
      paste: handlePaste,
      blur: handleBlur,
      focus: handleFocus
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('copy', handleCopy)
    document.addEventListener('paste', handlePaste)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
  }

  private unbindBrowserTelemetry() {
    if (this.activeListeners.visibilitychange) {
      document.removeEventListener('visibilitychange', this.activeListeners.visibilitychange)
    }
    if (this.activeListeners.fullscreenchange) {
      document.removeEventListener('fullscreenchange', this.activeListeners.fullscreenchange)
    }
    if (this.activeListeners.copy) {
      document.removeEventListener('copy', this.activeListeners.copy)
    }
    if (this.activeListeners.paste) {
      document.removeEventListener('paste', this.activeListeners.paste)
    }
    if (this.activeListeners.blur) {
      window.removeEventListener('blur', this.activeListeners.blur)
    }
    if (this.activeListeners.focus) {
      window.removeEventListener('focus', this.activeListeners.focus)
    }
    this.activeListeners = {}
  }
}
