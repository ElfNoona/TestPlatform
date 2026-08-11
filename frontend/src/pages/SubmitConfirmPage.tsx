/**
 * SubmitConfirmPage — shown after successful submission or time expiry.
 * TODO: fetch and display a summary of submitted answers (optional)
 * TODO: trigger proctoring upload prompt if recording was enabled
 */
export default function SubmitConfirmPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', gap: '1rem' }}>
      <h1 style={{ color: 'var(--color-success)' }}>Exam Submitted ✓</h1>
      <p style={{ color: 'var(--color-muted)' }}>
        Your answers have been recorded. You may close this window.
      </p>
      {/* TODO: show proctoring upload UI if proctoring is enabled */}
    </div>
  )
}
