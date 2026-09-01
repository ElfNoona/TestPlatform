import { useEffect, useRef, useState } from 'react'
import { ProctoringManager } from './ProctoringManager'
import { ProctoringStatus } from './types'

interface UseProctoringOptions {
  sessionId: string | null
  token: string | null
  proctoringOrigin?: string
}

export function useProctoring({ sessionId, token, proctoringOrigin }: UseProctoringOptions) {
  const [status, setStatus] = useState<ProctoringStatus>(sessionId ? 'CONNECTING' : 'UNAVAILABLE')
  const [cameraActive, setCameraActive] = useState<boolean>(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'completed' | 'error'>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  
  const managerRef = useRef<ProctoringManager | null>(null)

  useEffect(() => {
    if (!sessionId || !token) {
      setStatus('UNAVAILABLE')
      return
    }

    const manager = new ProctoringManager({
      sessionId,
      token,
      proctoringOrigin,
      onStatusChange: (s) => setStatus(s),
      onCameraStatusChange: (active) => {
        setCameraActive(active)
        setStream(managerRef.current?.getMediaStream() || null)
      },
      onUploadStatusChange: (upStatus) => setUploadStatus(upStatus)
    })

    managerRef.current = manager
    manager.start()

    return () => {
      manager.stop()
      managerRef.current = null
      setStream(null)
    }
  }, [sessionId, token, proctoringOrigin])

  const sendEvent = (eventType: string, metadata?: Record<string, any>) => {
    managerRef.current?.sendTelemetry(eventType, metadata)
  }

  const captureFinalSnapshot = async () => {
    if (managerRef.current) {
      return await managerRef.current.captureFinalSnapshot()
    }
    return false
  }

  return {
    status,
    cameraActive,
    uploadStatus,
    stream,
    sendEvent,
    captureFinalSnapshot
  }
}
export type { ProctoringStatus }
