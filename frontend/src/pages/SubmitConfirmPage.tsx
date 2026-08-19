import { useNavigate } from 'react-router-dom'

/**
 * SubmitConfirmPage — shown after successful submission or time expiry.
 */
export default function SubmitConfirmPage() {
  const navigate = useNavigate()

  return (
    <div className="submit-page">
      {/* Success icon */}
      <div className="submit-icon" aria-hidden="true">✓</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--color-success)' }}>
          Exam Submitted
        </h1>
        <p style={{ color: 'var(--color-muted)', maxWidth: 420, lineHeight: 1.7 }}>
          Your answers have been securely recorded. The proctoring session has ended.
          You may safely close this window.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 380, width: '100%', marginTop: '0.5rem' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.7, textAlign: 'center' }}>
          Results will be communicated via your registered contact details.
          Do not refresh or attempt to re-enter the exam.
        </p>
      </div>

      <button
        id="btn-back-home"
        className="btn-ghost"
        onClick={() => navigate('/login')}
        style={{ marginTop: '0.5rem' }}
      >
        Back to home
      </button>
    </div>
  )
}
