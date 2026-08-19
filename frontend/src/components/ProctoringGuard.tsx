import { useEffect, useRef, ReactNode } from 'react'
import { ProctoringStatus } from '../proctoring/types'

interface Props {
  status: ProctoringStatus
  cameraActive: boolean
  stream: MediaStream | null
  children: ReactNode
}

function statusColor(status: ProctoringStatus): string {
  switch (status) {
    case 'ACTIVE':       return 'var(--color-success)'
    case 'DEGRADED':     return 'var(--color-warning)'
    case 'CONNECTING':   return 'var(--color-warning)'
    case 'DISCONNECTED': return 'var(--color-danger)'
    default:             return 'var(--color-muted)'
  }
}

/**
 * ProctoringGuard — pure presentational component that overlays connection
 * alerts, the webcam preview circle, and active status badges over the exam layout.
 */
export default function ProctoringGuard({ status, cameraActive, stream, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Attach webcam stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const isInactive = status === 'UNAVAILABLE'

  return (
    <>
      {/* Main Content Wrapper */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
        
        {/* Connection Degraded Alert Banner */}
        {!isInactive && (status === 'DEGRADED' || status === 'DISCONNECTED') && (
          <div
            style={{
              background: 'rgba(230, 193, 90, 0.08)',
              borderBottom: '1px solid var(--color-warning)',
              padding: '0.65rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.78rem',
              color: 'var(--color-warning)',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              Proctoring connection interrupted. Your activity is currently being buffered locally and will synchronize automatically once connection stabilizes.
            </span>
          </div>
        )}

        {children}

        {/* Live Proctoring Status and Preview Widget */}
        {!isInactive && (
          <div
            style={{
              position: 'fixed',
              bottom: '1rem',
              right: '1rem',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: 'flex-end',
              pointerEvents: 'none',
            }}
          >
            {/* 1. Camera Preview Box */}
            <div
              style={{
                width: '120px',
                height: '90px',
                borderRadius: 'var(--radius)',
                border: `1.5px solid ${cameraActive ? 'var(--color-border)' : 'var(--color-danger)'}`,
                background: '#0c0c0f',
                boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                transition: 'all 0.3s ease',
              }}
            >
              {cameraActive ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scaleX(-1)', // mirror preview
                  }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', color: 'var(--color-danger)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
                    <path d="L23 7l-7 5 7 5V7z" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                  <span style={{ fontSize: '0.55rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cam Offline</span>
                </div>
              )}

              <div
                style={{
                  position: 'absolute',
                  top: '4px',
                  left: '4px',
                  background: 'rgba(0,0,0,0.6)',
                  padding: '2px 4px',
                  borderRadius: '2px',
                  fontSize: '0.52rem',
                  fontWeight: 600,
                  color: cameraActive ? 'var(--color-success)' : 'var(--color-danger)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2.5px',
                  textTransform: 'uppercase',
                }}
              >
                <span
                  style={{
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: cameraActive ? 'var(--color-success)' : 'var(--color-danger)',
                    display: 'inline-block',
                  }}
                />
                Cam
              </div>
            </div>

            {/* 2. Connection Status Badge */}
            <div
              className="proctoring-badge"
              style={{
                position: 'relative',
                zIndex: 100,
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.4rem 0.75rem',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.72rem',
                color: 'var(--color-text)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
              title={
                status === 'DEGRADED' || status === 'DISCONNECTED'
                  ? 'Proctoring connection unstable. Your events are buffered safely.'
                  : 'Proctoring monitoring active.'
              }
            >
              <span
                className="dot"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  display: 'inline-block',
                  background: statusColor(status),
                  boxShadow: `0 0 8px ${statusColor(status)}`,
                }}
              />
              <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.04em' }}>
                {status === 'ACTIVE' && 'Proctoring Active'}
                {status === 'CONNECTING' && 'Connecting...'}
                {status === 'DEGRADED' && 'Buffered / Syncing'}
                {status === 'DISCONNECTED' && 'Offline'}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
