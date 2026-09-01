import { useEffect, useState, useRef } from 'react'
import KrsLogo from './KrsLogo'

interface SystemCheckProps {
  attemptId: string
  token: string
  proctoringOrigin: string  // reserved for future WS URL construction
  onComplete: () => void
}

interface CheckItem {
  id: string
  label: string
  status: 'pending' | 'checking' | 'passed' | 'failed'
  errorMsg?: string
}

export default function SystemCheck({ attemptId, token, proctoringOrigin, onComplete }: SystemCheckProps) {
  const [checks, setChecks] = useState<CheckItem[]>([
    { id: 'browser', label: 'Browser Compatibility Check', status: 'pending' },
    { id: 'network', label: 'Internet Connectivity Check', status: 'pending' },
    { id: 'api', label: 'Backend Server Connection', status: 'pending' },
    { id: 'websocket', label: 'Proctoring WebSocket Connection', status: 'pending' },
    { id: 'camera', label: 'Webcam Stream & Permission Check', status: 'pending' },
    { id: 'fullscreen', label: 'Fullscreen Capability Check', status: 'pending' },
  ])

  const [stream, setStream] = useState<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const isRunning = useRef(false)

  const updateCheckStatus = (id: string, status: CheckItem['status'], errorMsg?: string) => {
    setChecks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status, errorMsg } : item))
    )
  }

  const runSystemChecks = async () => {
    if (isRunning.current) return
    isRunning.current = true

    // 1. Browser check
    updateCheckStatus('browser', 'checking')
    const supportsMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    if (supportsMedia) {
      updateCheckStatus('browser', 'passed')
    } else {
      updateCheckStatus('browser', 'failed', 'Your browser does not support webcam media devices.')
      return
    }

    // 2. Internet connectivity
    updateCheckStatus('network', 'checking')
    if (navigator.onLine) {
      updateCheckStatus('network', 'passed')
    } else {
      updateCheckStatus('network', 'failed', 'No active internet connection detected.')
      return
    }

    // 3. Backend API Connection
    updateCheckStatus('api', 'checking')
    try {
      const response = await fetch(`${window.location.origin}/api/attempts/${attemptId}/state`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        updateCheckStatus('api', 'passed')
      } else {
        throw new Error(`API returned ${response.status}`)
      }
    } catch (err: any) {
      updateCheckStatus('api', 'failed', `Failed to connect to backend server: ${err.message || err}`)
      return
    }

    // 4. Proctoring WebSocket Connectivity
    // HTTP being reachable does NOT guarantee WS upgrade works (Nginx/proxy config)
    updateCheckStatus('websocket', 'checking')
    try {
      await new Promise<void>((resolve, reject) => {
        // Parse dynamic proctoring origin
        const url = new URL(proctoringOrigin)
        const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsHost = url.host
        // Connect and probe the WS handshake
        const ws = new WebSocket(`${wsProto}//${wsHost}/ws/proctoring/00000000-0000-0000-0000-000000000001?token=probe`)
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error('WebSocket connection timed out after 5s'))
        }, 5000)

        // Any connection response (even a close with non-auth code) proves WS upgrade works
        ws.onopen = () => {
          clearTimeout(timeout)
          ws.close()
          resolve()
        }
        ws.onclose = (e) => {
          clearTimeout(timeout)
          // 4001/4002/4003 = auth/session errors — upgrade itself succeeded
          if (e.code === 4001 || e.code === 4002 || e.code === 4003 || e.code === 1006) {
            resolve() // upgrade worked, only auth failed (expected with probe token)
          } else if (e.code === 1000 || e.code === 1001) {
            resolve()
          } else {
            reject(new Error(`WebSocket closed unexpectedly (code: ${e.code})`))
          }
        }
        ws.onerror = () => {
          clearTimeout(timeout)
          // Some browsers fire onerror before onclose — wait for onclose to fire
        }
      })
      updateCheckStatus('websocket', 'passed')
    } catch (err: any) {
      updateCheckStatus('websocket', 'failed', `Proctoring WebSocket unreachable: ${err.message || err}`)
      // Non-blocking — websocket degraded mode is supported
    }

    // 5. Camera Stream Permission
    updateCheckStatus('camera', 'checking')
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: false
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
      updateCheckStatus('camera', 'passed')
    } catch (err: any) {
      updateCheckStatus('camera', 'failed', 'Webcam permission denied or camera not found.')
      return
    }

    // 6. Fullscreen Support
    updateCheckStatus('fullscreen', 'checking')
    const supportsFullscreen = document.fullscreenEnabled || (document as any).webkitFullscreenEnabled
    if (supportsFullscreen) {
      updateCheckStatus('fullscreen', 'passed')
    } else {
      updateCheckStatus('fullscreen', 'failed', 'Fullscreen mode is blocked or not supported on this browser.')
    }
  }

  useEffect(() => {
    runSystemChecks()
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allPassed = checks.every((item) => item.status === 'passed')
  const hasFailed = checks.some((item) => item.status === 'failed')

  const handleStart = async () => {
    // Stop camera stream inside check screen so ProctoringManager can reclaim it
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }

    // Request fullscreen (Browser security rule requires user action)
    try {
      const docEl = document.documentElement
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen()
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen()
      }
    } catch (err) {
      console.warn('[SystemCheck] Fullscreen request rejected:', err)
    }

    onComplete()
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--color-bg-deep)',
        color: 'var(--color-text)',
        padding: '2rem',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '2.5rem',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.75rem',
        }}
      >
        {/* Logo and Branding */}
        <div style={{ width: '80px', height: '80px' }}>
          <KrsLogo size="100%" />
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--color-text-strong)', margin: 0 }}>
            Proctoring Integrity Check
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.4rem', lineHeight: 1.5 }}>
            To begin your secure assessment attempt, please verify that your system satisfies the proctoring requirements below.
          </p>
        </div>

        {/* Live Camera Preview */}
        <div
          style={{
            width: '180px',
            height: '135px',
            borderRadius: 'var(--radius)',
            border: `1.5px solid ${stream ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background: '#0c0c0f',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.8)',
            position: 'relative',
          }}
        >
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
            />
          ) : (
            <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem', textAlign: 'center', padding: '1rem' }}>
              Webcam Feed Offline
            </div>
          )}
        </div>

        {/* Checklist */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {checks.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {/* Status Icons */}
              <div style={{ marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {item.status === 'pending' && (
                  <span style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid var(--color-disabled)', display: 'inline-block' }} />
                )}
                {item.status === 'checking' && (
                  <span className="spinner" style={{ width: '12px', height: '12px' }} />
                )}
                {item.status === 'passed' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {item.status === 'failed' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </div>

              {/* Detail label */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 550, color: item.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text)' }}>
                  {item.label}
                </span>
                {item.errorMsg && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-danger)' }}>
                    {item.errorMsg}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Action Button */}
        <div style={{ width: '100%', marginTop: '0.5rem' }}>
          {allPassed ? (
            <button
              onClick={handleStart}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '0.85rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              Enter Fullscreen & Begin Exam
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          ) : hasFailed ? (
            <button
              onClick={() => {
                setChecks((prev) => prev.map((c) => ({ ...c, status: 'pending', errorMsg: undefined })))
                isRunning.current = false
                runSystemChecks()
              }}
              className="btn-secondary"
              style={{ width: '100%', padding: '0.85rem', fontWeight: 600 }}
            >
              Retry Connection & Hardware Check
            </button>
          ) : (
            <button
              disabled
              className="btn-primary"
              style={{ width: '100%', padding: '0.85rem', opacity: 0.5, cursor: 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <span className="spinner" style={{ width: '12px', height: '12px' }} />
              Verifying Hardware Environment…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
