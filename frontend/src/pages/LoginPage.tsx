import { useState, FormEvent, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../utils/api'
import KrsLogo from '../components/KrsLogo'

/* Animated scanning ring component */
function ScanRing({ size, delay, duration, color }: { size: number; delay: number; duration: number; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `1px solid ${color}`,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        animation: `scan-pulse ${duration}s ease-in-out ${delay}s infinite`,
        pointerEvents: 'none',
      }}
    />
  )
}

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [isTeacherMode, setIsTeacherMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { login } = useAuth()

  useEffect(() => {
    // small delay so the entry animation completes first
    const t = setTimeout(() => inputRef.current?.focus(), 600)
    return () => clearTimeout(t)
  }, [isTeacherMode])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isTeacherMode) {
        const data = await api.teacherLogin(code.trim().toUpperCase())
        localStorage.setItem('teacher_token', data.token)
        navigate('/teacher')
      } else {
        const data = await api.startAttempt(code.trim().toUpperCase())
        login(
          data.token,
          data.attemptId,
          data.proctoring?.sessionId ?? null,
          data.proctoring?.status ?? null
        )
        navigate(`/exam/${data.attemptId}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid access code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleInput(val: string) {
    if (isTeacherMode) {
      setCode(val.toUpperCase())
      if (error) setError(null)
      return
    }
    // Auto-format: insert dash after 4 chars
    const raw = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
    const formatted = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
    setCode(formatted)
    if (error) setError(null)
  }

  return (
    <div className="login-root">
      {/* ── LEFT VISUAL PANEL ─────────────────────────────────────── */}
      <div className="login-visual-panel">
        {/* Background grid */}
        <div className="login-grid" aria-hidden="true" />

        {/* Corner decorations */}
        <div className="login-corner login-corner--tl" aria-hidden="true" />
        <div className="login-corner login-corner--tr" aria-hidden="true" />
        <div className="login-corner login-corner--bl" aria-hidden="true" />
        <div className="login-corner login-corner--br" aria-hidden="true" />

        {/* Ambient glow blobs */}
        <div className="login-glow login-glow--gold" aria-hidden="true" />
        <div className="login-glow login-glow--teal" aria-hidden="true" />

        {/* Center emblem area */}
        <div className="login-emblem-wrap" aria-hidden="true">
          {/* Scanning rings */}
          <ScanRing size={340} delay={0}   duration={3.5} color="rgba(197,160,58,0.12)" />
          <ScanRing size={280} delay={0.5} duration={3.5} color="rgba(197,160,58,0.18)" />
          <ScanRing size={220} delay={1.0} duration={3.5} color="rgba(118,199,192,0.15)" />
          <ScanRing size={160} delay={1.5} duration={3.5} color="rgba(197,160,58,0.22)" />

          {/* KRS emblem */}
          <KrsLogo className="login-emblem-svg" size={170} />
        </div>

        {/* Bottom tagline */}
        <div className="login-panel-tagline">
          <span className="login-panel-tagline-dot" />
          ASSESSMENT SYSTEM  ·  SECURE SESSION
          <span className="login-panel-tagline-dot" />
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ─────────────────────────────────────── */}
      <div className="login-form-panel">
        {/* Top bar inside panel */}
        <div className="login-form-topbar">
          <div className="login-platform-chip">
            <span className="login-platform-chip-dot" />
            KRS Assessment Platform
          </div>
        </div>

        <div className="login-form-content">
          {/* Heading */}
          <div className="login-heading-group">
            <p className="login-eyebrow">{isTeacherMode ? 'Teacher Admin Portal' : 'Candidate Portal'}</p>
            <h1 className="login-title">
              {isTeacherMode ? (
                <>Enter Your<br /><em>Teacher Code</em></>
              ) : (
                <>Enter Your<br /><em>Access Code</em></>
              )}
            </h1>
            <p className="login-subtitle">
              {isTeacherMode
                ? 'Enter the administrative access code to log in and review assessments, manage candidates, and view proctoring incidents.'
                : 'Your unique code was provided by your exam coordinator. Enter it below to begin your assessment session.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="login-form">
            <div className={`login-field ${focused ? 'login-field--focused' : ''} ${error ? 'login-field--error' : ''}`}>
              <label htmlFor="exam-code" className="login-field-label">
                {isTeacherMode ? 'Teacher Code' : 'Access Code'}
              </label>
              <div className="login-field-input-wrap">
                {/* Lock icon */}
                <svg className="login-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <input
                  ref={inputRef}
                  id="exam-code"
                  type="text"
                  value={code}
                  onChange={(e) => handleInput(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={isTeacherMode ? 'TEACHER-XXXX' : 'XXXX-XXXX'}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="login-field-input"
                />
                {code.length > 0 && (
                  <button
                    type="button"
                    className="login-field-clear"
                    onClick={() => { setCode(''); setError(null); inputRef.current?.focus() }}
                    aria-label="Clear code"
                  >
                    ✕
                  </button>
                )}
              </div>
              {error && (
                <div className="login-field-error" role="alert">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              id="btn-start-exam"
              disabled={loading || (isTeacherMode ? code.length === 0 : code.replace('-', '').length < 8)}
              className="login-submit-btn"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Validating Session…
                </>
              ) : (
                <>
                  {isTeacherMode ? 'Access Dashboard' : 'Begin Assessment'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12,5 19,12 12,19"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Help note */}
          <div className="login-help-note" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div>
                {isTeacherMode ? (
                  <span>Administrative login requires a teacher access code (e.g. <code>TEACHER-2026</code> in dev).</span>
                ) : (
                  <span>Codes follow the format <code>XXXX-XXXX</code>. Contact your coordinator if you haven't received yours.</span>
                )}
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => {
                setIsTeacherMode(!isTeacherMode)
                setCode('')
                setError(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-accent)',
                fontSize: '0.78rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
                alignSelf: 'center',
                marginTop: '0.5rem'
              }}
            >
              {isTeacherMode ? 'Switch to Candidate Portal' : 'Are you a teacher? Access the admin dashboard'}
            </button>
          </div>
        </div>

        {/* Bottom status bar */}
        <div className="login-form-statusbar">
          <div className="login-secured-badge">
            <span className="login-secured-dot" />
            Secured by KRS Proctoring
          </div>
          <div className="login-version-tag">v2.0</div>
        </div>
      </div>
    </div>
  )
}
