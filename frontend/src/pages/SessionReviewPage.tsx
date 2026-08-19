import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import KrsLogo from '../components/KrsLogo'

interface Student {
  name: string
  access_code: string
  slot_id: string | null
}

interface ProctorSession {
  id: string
  attempt_id: string
  student_id: string
  risk_score: number
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: string
  connection_status: string
  started_at: string
  ended_at: string | null
}

interface ProctorEvent {
  id: string
  type: string
  client_timestamp: string
  server_timestamp: string
  duration_ms: number
  metadata: Record<string, any>
  sequence_number: number
}

interface ProctorMedia {
  id: string
  event_id: string | null
  media_type: 'webcam' | 'desktop'
  status: string
  storage_key: string
  captured_at: string
}

interface ReviewDecision {
  id: string
  decision: 'VALID' | 'SUSPICIOUS' | 'VIOLATION'
  comment: string | null
  reviewed_at: string
}

export default function SessionReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  
  const [token] = useState<string | null>(() => localStorage.getItem('teacher_token'))
  const [loading, setLoading] = useState(true)
  const [submittingReview, setSubmittingReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [student, setStudent] = useState<Student | null>(null)
  const [session, setSession] = useState<ProctorSession | null>(null)
  const [events, setEvents] = useState<ProctorEvent[]>([])
  const [media, setMedia] = useState<ProctorMedia[]>([])
  const [reviews, setReviews] = useState<ReviewDecision[]>([])

  // Lightbox / Image Zoom State
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  
  // Review Form State
  const [verdict, setVerdict] = useState<'VALID' | 'SUSPICIOUS' | 'VIOLATION'>('VALID')
  const [comment, setComment] = useState('')
  const [reviewSuccess, setReviewSuccess] = useState(false)

  async function fetchSessionData() {
    if (!sessionId || !token) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getSessionDetails(sessionId, token)
      setStudent(data.student)
      setSession(data.session)
      setEvents(data.events || [])
      setMedia(data.media || [])
      setReviews(data.reviews || [])
      
      if (data.reviews && data.reviews.length > 0) {
        setVerdict(data.reviews[0].decision)
        setComment(data.reviews[0].comment || '')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch session review data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/login')
      return
    }
    fetchSessionData()
  }, [sessionId, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!sessionId || !token) return
    setSubmittingReview(true)
    setError(null)
    setReviewSuccess(false)
    try {
      await api.submitSessionReview(sessionId, { decision: verdict, comment }, token)
      setReviewSuccess(true)
      // Refresh session metadata to update local scores
      const data = await api.getSessionDetails(sessionId, token)
      setSession(data.session)
      setReviews(data.reviews || [])
    } catch (err: any) {
      setError(err.message || 'Failed to submit integrity review.')
    } finally {
      setSubmittingReview(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', gap: '1rem', color: 'var(--color-muted)' }}>
        <span className="spinner" style={{ width: 24, height: 24 }} />
        <span>Loading session audit details…</span>
      </div>
    )
  }

  if (!session || !student) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', gap: '1rem', color: 'var(--color-muted)' }}>
        <KrsLogo size={40} />
        <h2>Audit Session Not Found</h2>
        <p style={{ fontSize: '0.85rem' }}>The requested proctoring session ID is invalid or could not be retrieved.</p>
        <button className="btn-ghost" onClick={() => navigate('/teacher')} style={{ marginTop: '1rem' }}>
          ← Return to Dashboard
        </button>
      </div>
    )
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: '1.25rem',
        padding: '0.85rem 1.75rem',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}>
        <button
          className="btn-ghost"
          onClick={() => navigate('/teacher')}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          ← Dashboard
        </button>
        <div style={{ height: '18px', width: '1px', background: 'var(--color-border)' }} />
        <span style={{ fontFamily: 'var(--font-wordmark)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
          Session Audit Log
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          Session: <code style={{ fontFamily: 'var(--font-mono)' }}>{session.id.slice(0, 8)}</code>
        </span>
      </header>

      {/* Main Body */}
      <div style={{ flex: 1, padding: '2rem 2.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {error && (
          <div style={{
            padding: '0.85rem 1.25rem',
            background: 'rgba(209,69,56,0.08)',
            border: '1px solid rgba(209,69,56,0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            color: 'var(--color-danger)'
          }}>
            ⚠ {error}
          </div>
        )}
        
        {/* Candidate Detail Card */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1.5rem',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
              {student.name}
            </h1>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
              Access Code: <code style={{ color: 'var(--color-accent)' }}>{student.access_code}</code> · Slot: {student.slot_id || '—'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Risk Level</span>
              <span style={{
                fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase',
                color: session.risk_level === 'CRITICAL' ? 'var(--color-danger)' : session.risk_level === 'HIGH' ? '#e07030' : session.risk_level === 'MEDIUM' ? 'var(--color-warning)' : 'var(--color-success)',
                background: session.risk_level === 'CRITICAL' ? 'rgba(209,69,56,0.1)' : session.risk_level === 'HIGH' ? 'rgba(224,112,48,0.1)' : session.risk_level === 'MEDIUM' ? 'rgba(230,193,90,0.1)' : 'rgba(118,199,192,0.1)',
                border: `1px solid ${session.risk_level === 'CRITICAL' ? 'rgba(209,69,56,0.2)' : session.risk_level === 'HIGH' ? 'rgba(224,112,48,0.2)' : session.risk_level === 'MEDIUM' ? 'rgba(230,193,90,0.2)' : 'rgba(118,199,192,0.2)'}`
              }}>
                {session.risk_level}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Risk Score</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: session.risk_score > 70 ? 'var(--color-danger)' : 'var(--color-text-strong)' }}>
                {session.risk_score}/100
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Connection Status</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--color-text)' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: session.connection_status === 'CONNECTED' ? 'var(--color-success)' : 'var(--color-muted)',
                  boxShadow: session.connection_status === 'CONNECTED' ? '0 0 6px var(--color-success)' : 'none'
                }} />
                {session.connection_status}
              </span>
            </div>
          </div>
        </div>

        {/* Dual-Column Work Area */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', flex: 1, alignItems: 'stretch' }}>
          
          {/* Timeline Events Column (Left) */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
                Timeline Audit Log
              </h2>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Chronological proctoring incident events received during attempt.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem', paddingRight: '0.4rem', maxHeight: '480px' }}>
              {events.length === 0 ? (
                <div style={{ color: 'var(--color-faint)', fontSize: '0.8rem', textAlign: 'center', padding: '3rem 0' }}>
                  No proctoring events recorded for this session.
                </div>
              ) : (
                events.map((ev) => {
                  const isCritical = ['TAB_HIDDEN', 'FULLSCREEN_EXITED', 'CAMERA_STOPPED', 'SCREEN_SHARE_STOPPED'].includes(ev.type)
                  const isWarning = ['FOCUS_LOST', 'PASTE_DETECTED'].includes(ev.type)
                  
                  return (
                    <div
                      key={ev.id}
                      style={{
                        padding: '0.75rem 1rem',
                        background: 'var(--color-bg-deep)',
                        border: isCritical ? '1px solid rgba(209,69,56,0.25)' : isWarning ? '1px solid rgba(230,193,90,0.25)' : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.35rem',
                        boxShadow: isCritical ? 'inset 3px 0 0 var(--color-danger)' : isWarning ? 'inset 3px 0 0 var(--color-warning)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{
                          fontWeight: 600, fontSize: '0.72rem', letterSpacing: '0.02em',
                          color: isCritical ? 'var(--color-danger)' : isWarning ? 'var(--color-warning)' : 'var(--color-muted)'
                        }}>
                          {ev.type.replace('_', ' ')}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--color-faint)', fontFamily: 'var(--font-mono)' }}>
                          {formatTime(ev.client_timestamp)}
                        </span>
                      </div>

                      {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', background: 'rgba(255,255,255,0.01)', padding: '0.25rem 0.5rem', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          {Object.entries(ev.metadata).map(([k, v]) => (
                            <div key={k}>
                              <span style={{ color: 'var(--color-faint)' }}>{k}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Media Evidence Column (Right) */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
                Snapshot Evidence Logs
              </h2>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Verification snapshots captured from webcam feed or screen sharing stream.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '480px' }}>
              {media.length === 0 ? (
                <div style={{ color: 'var(--color-faint)', fontSize: '0.8rem', textAlign: 'center', padding: '5rem 0' }}>
                  No image evidence captured for this attempt.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                  {media.map((med) => (
                    <div
                      key={med.id}
                      style={{
                        background: 'var(--color-bg-deep)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        cursor: 'zoom-in',
                        transition: 'transform 0.15s ease',
                      }}
                      onClick={() => setLightboxImage(med.storage_key)}
                      className="card-hover"
                    >
                      <div style={{ position: 'relative', width: '100%', paddingBottom: '66.6%' }}>
                        <img
                          src={med.storage_key}
                          alt={med.media_type}
                          style={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
                          }}
                        />
                        <span style={{
                          position: 'absolute', bottom: '0.4rem', right: '0.4rem',
                          fontSize: '0.62rem', fontWeight: 600, padding: '0.1rem 0.4rem',
                          borderRadius: '2px', textTransform: 'uppercase',
                          background: 'rgba(0,0,0,0.7)', color: 'var(--color-text-strong)'
                        }}>
                          {med.media_type}
                        </span>
                      </div>
                      
                      <div style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--color-text)', fontWeight: 500 }}>
                          {formatTime(med.captured_at)}
                        </span>
                        <span style={{ fontSize: '0.62rem', color: 'var(--color-faint)' }}>
                          Status: {med.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Audit Review decision Card */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: '1.5rem',
          boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
              Integrity Verdict Submission
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
              Record your administrative evaluation of the attempt session history evidence.
            </p>
          </div>

          <form onSubmit={handleSubmitReview} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {(['VALID', 'SUSPICIOUS', 'VIOLATION'] as const).map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: verdict === opt ? 'rgba(197,160,58,0.06)' : 'transparent',
                    borderColor: verdict === opt ? 'var(--color-accent)' : 'var(--color-border)',
                    color: verdict === opt ? 'var(--color-accent)' : 'var(--color-text)',
                    fontSize: '0.8rem', fontWeight: verdict === opt ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <input
                    type="radio"
                    name="verdict"
                    value={opt}
                    checked={verdict === opt}
                    onChange={() => setVerdict(opt)}
                    style={{ accentColor: 'var(--color-accent)', width: 14, height: 14 }}
                  />
                  {opt === 'VALID' ? '✅ Valid Session' : opt === 'SUSPICIOUS' ? '⚠️ Suspicious Activity' : '🚫 Integrity Violation'}
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label htmlFor="teacher-comment" style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Auditor Notes / Comments
              </label>
              <textarea
                id="teacher-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe any suspicious actions, browser switches, or notes regarding the student's attempt verification."
                rows={3}
                style={{ fontSize: '0.8rem', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingReview}
                style={{ fontSize: '0.78rem', padding: '0.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {submittingReview && <span className="spinner" style={{ width: 10, height: 10, color: 'var(--color-bg-deep)' }} />}
                Submit Verdict
              </button>

              {reviewSuccess && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Verdict saved successfully.
                </span>
              )}
            </div>
          </form>

          {reviews.length > 0 && (
            <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '1rem' }}>
              <h3 style={{ fontSize: '0.8rem', color: 'var(--color-text-strong)', marginBottom: '0.5rem' }}>Review History</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {reviews.map((rev) => (
                  <div key={rev.id} style={{ padding: '0.6rem 0.85rem', background: 'var(--color-bg-deep)', borderRadius: '2px', border: '1px solid var(--color-border)', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{rev.decision}</span>
                      <span style={{ color: 'var(--color-faint)', fontSize: '0.7rem' }}>{new Date(rev.reviewed_at).toLocaleString()}</span>
                    </div>
                    {rev.comment && <p style={{ margin: 0, color: 'var(--color-muted)' }}>{rev.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox / Image Zoom Overlay Modal */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(10,10,10,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
          onClick={() => setLightboxImage(null)}
        >
          <div style={{ position: 'relative', maxWidth: '85vw', maxHeight: '85vh' }}>
            <button
              style={{
                position: 'absolute', top: '-2rem', right: 0,
                background: 'none', border: 'none', color: '#fff',
                fontSize: '1.2rem', cursor: 'pointer'
              }}
              onClick={() => setLightboxImage(null)}
            >
              ✕ Close
            </button>
            <img
              src={lightboxImage}
              alt="Zoomed Evidence"
              style={{ width: '100%', height: '100%', objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
