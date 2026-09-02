interface Props {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  totalQuestions: number
  answeredQuestions: number
  loading: boolean
}

export default function SubmitModal({
  isOpen,
  onClose,
  onConfirm,
  totalQuestions,
  answeredQuestions,
  loading,
}: Props) {
  if (!isOpen) return null

  const unanswered = totalQuestions - answeredQuestions

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-card">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-caps">Assessment Protocol</div>
        </div>

        {/* Body */}
        <div className="modal-body">
          <h2 id="modal-title" className="modal-body-title">Submit Assessment</h2>
          <p className="modal-body-sub">
            {answeredQuestions} of {totalQuestions} questions answered.
          </p>

          {unanswered > 0 && (
            <div className="modal-warning-box">
              <div className="modal-warning-title">
                <span>⚠</span>
                <span>Action Required</span>
              </div>
              <p className="modal-warning-text">
                You have {unanswered} unanswered question{unanswered > 1 ? 's' : ''}. If you choose to submit status now, you cannot modify your answers later.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="btn-ghost"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            ← Return to Exam
          </button>
          <button
            className="btn-danger"
            onClick={onConfirm}
            disabled={loading}
            style={{ padding: '0.45rem 1.5rem', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" />
                Submitting…
              </span>
            ) : (
              'Confirm Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
