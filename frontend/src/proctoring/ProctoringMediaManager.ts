
export class ProctoringMediaManager {
  private sessionId: string
  private token: string
  private proctoringOrigin: string
  private stream: MediaStream | null = null
  private videoElement: HTMLVideoElement | null = null
  private canvasElement: HTMLCanvasElement | null = null
  
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null
  private lastCaptureTime: number = 0
  private captureCooldownMs: number = 5000 // 5 seconds cooldown
  private snapshotIntervalMs: number = 60000 // 60 seconds interval

  private onUploadStatusChange: ((status: 'idle' | 'uploading' | 'completed' | 'error') => void) | null = null
  private onCameraStatusChange: ((active: boolean) => void) | null = null

  constructor(sessionId: string, token: string, proctoringOrigin: string) {
    this.sessionId = sessionId
    this.token = token
    // Normalize origin: e.g. http://localhost:7000
    this.proctoringOrigin = proctoringOrigin.replace(/\/$/, '')
  }

  public registerCallbacks(
    onUploadStatus: (status: 'idle' | 'uploading' | 'completed' | 'error') => void,
    onCameraStatus: (active: boolean) => void
  ) {
    this.onUploadStatusChange = onUploadStatus
    this.onCameraStatusChange = onCameraStatus
  }

  public getStream(): MediaStream | null {
    return this.stream
  }

  public async initializeCamera(): Promise<boolean> {
    try {
      if (this.stream) {
        this.stopCamera()
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: { ideal: 5, max: 10 } },
        audio: false
      })

      // Create hidden video element to feed the canvas
      this.videoElement = document.createElement('video')
      this.videoElement.srcObject = this.stream
      this.videoElement.autoplay = true
      this.videoElement.playsInline = true
      this.videoElement.muted = true
      
      // Wait for metadata/play
      await new Promise<void>((resolve) => {
        if (this.videoElement) {
          this.videoElement.onloadedmetadata = () => {
            this.videoElement?.play().then(() => resolve()).catch(() => resolve())
          }
        } else {
          resolve()
        }
      })

      this.canvasElement = document.createElement('canvas')
      this.canvasElement.width = 320
      this.canvasElement.height = 240

      this.onCameraStatusChange?.(true)
      console.log('[MediaManager] Webcam initialized successfully.')
      return true
    } catch (err) {
      console.error('[MediaManager] Failed to initialize camera:', err)
      this.onCameraStatusChange?.(false)
      return false
    }
  }

  public startSnapshotCycle() {
    this.stopSnapshotCycle()
    
    // Perform initial capture
    this.captureSnapshot('START_SNAPSHOT')

    // Start 60-second periodic captures
    this.snapshotIntervalId = setInterval(() => {
      this.captureSnapshot('WEBCAM_SNAPSHOT')
    }, this.snapshotIntervalMs)
  }

  public stopSnapshotCycle() {
    if (this.snapshotIntervalId) {
      clearInterval(this.snapshotIntervalId)
      this.snapshotIntervalId = null
    }
  }

  public stopCamera() {
    this.stopSnapshotCycle()
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }
    if (this.videoElement) {
      this.videoElement.pause()
      this.videoElement.srcObject = null
      this.videoElement = null
    }
    this.canvasElement = null
    this.onCameraStatusChange?.(false)
    console.log('[MediaManager] Webcam stopped.')
  }

  /**
   * Captures a snapshot from the webcam stream and uploads it to storage.
   * Leverages event cooldown to prevent flooding.
   */
  public async captureSnapshot(
    mediaType: 'WEBCAM_SNAPSHOT' | 'EVENT_SNAPSHOT' | 'START_SNAPSHOT' | 'FINAL_SNAPSHOT',
    clientEventId?: string
  ): Promise<boolean> {
    const now = Date.now()
    if (mediaType === 'EVENT_SNAPSHOT' && now - this.lastCaptureTime < this.captureCooldownMs) {
      console.log('[MediaManager] Event snapshot requested during cooldown. Skipping.')
      return false
    }

    if (!this.stream || !this.videoElement || !this.canvasElement) {
      console.warn('[MediaManager] Stream not active. Cannot capture snapshot.')
      return false
    }

    this.lastCaptureTime = now

    try {
      const ctx = this.canvasElement.getContext('2d')
      if (!ctx) return false

      // Draw current video frame to canvas
      ctx.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height)

      // Convert to JPEG blob
      const blob = await new Promise<Blob | null>((resolve) => {
        this.canvasElement?.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
      })

      if (!blob) {
        console.error('[MediaManager] Failed to generate snapshot blob.')
        return false
      }

      // Upload in background to avoid blocking the main thread
      this.uploadBlobWithRetry(blob, mediaType, clientEventId)
      return true
    } catch (err) {
      console.error('[MediaManager] Snapshot capture failed:', err)
      return false
    }
  }

  private async uploadBlobWithRetry(
    blob: Blob,
    mediaType: string,
    clientEventId?: string,
    retries = 3
  ): Promise<boolean> {
    this.onUploadStatusChange?.('uploading')
    let currentAttempt = 0

    while (currentAttempt < retries) {
      try {
        console.log(`[MediaManager] Requesting upload URL for ${mediaType} (attempt ${currentAttempt + 1})...`)
        // 1. Request presigned URL
        const uploadUrlRes = await fetch(`${this.proctoringOrigin}/api/v1/media/upload-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({
            sessionId: this.sessionId,
            mediaType,
            mimeType: 'image/jpeg',
            sizeBytes: blob.size,
            clientEventId: clientEventId || undefined,
            capturedAt: new Date().toISOString()
          })
        })

        if (!uploadUrlRes.ok) {
          throw new Error(`Failed to get upload URL: ${uploadUrlRes.statusText}`)
        }

        const { mediaId, uploadUrl } = await uploadUrlRes.json()

        // 2. Perform direct upload to storage (R2 / Mock Local Storage)
        const targetUrl = uploadUrl.startsWith('http') ? uploadUrl : `${this.proctoringOrigin}${uploadUrl}`
        console.log(`[MediaManager] Uploading binary to R2/Local Storage via PUT to ${targetUrl}`)

        const uploadRes = await fetch(targetUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg'
          },
          body: blob
        })

        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadRes.statusText}`)
        }

        // 3. Complete upload on backend
        console.log(`[MediaManager] Confirming upload completion on backend for mediaId: ${mediaId}`)
        const completeRes = await fetch(`${this.proctoringOrigin}/api/v1/media/${mediaId}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({
            sizeBytes: blob.size
          })
        })

        if (!completeRes.ok) {
          throw new Error(`Complete confirmation failed: ${completeRes.statusText}`)
        }

        console.log('[MediaManager] Snapshot upload completed successfully.')
        this.onUploadStatusChange?.('completed')
        return true
      } catch (err) {
        console.error(`[MediaManager] Upload attempt ${currentAttempt + 1} failed:`, err)
        currentAttempt++
        if (currentAttempt < retries) {
          // Linear backoff: wait 1s, 2s, 3s before retrying
          await new Promise((resolve) => setTimeout(resolve, currentAttempt * 1000))
        }
      }
    }

    console.error(`[MediaManager] Upload failed permanently after ${retries} attempts.`)
    this.onUploadStatusChange?.('error')
    return false
  }
}
