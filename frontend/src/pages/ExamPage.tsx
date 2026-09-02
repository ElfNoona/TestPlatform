import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, useCallback } from 'react'
import ExamTimer from '../components/ExamTimer'
import KrsLogo from '../components/KrsLogo'
import QuestionRenderer from '../components/QuestionRenderer'
import QuestionNav from '../components/QuestionNav'
import AutosaveIndicator, { SaveStatus } from '../components/AutosaveIndicator'
import ProctoringGuard from '../components/ProctoringGuard'
import SubmitModal from '../components/SubmitModal'
import { useAuth } from '../context/AuthContext'
import { api, AttemptState } from '../utils/api'
import SystemCheck from '../components/SystemCheck'
import { useProctoring } from '../proctoring/useProctoring'

export default function ExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate       = useNavigate()
  const { token, proctoringSessionId, proctoringStatus } = useAuth()

  const [state,           setState]          = useState<AttemptState | null>(null)
  const [error,           setError]          = useState<string | null>(null)
  const [questionIdx,     setQuestionIdx]    = useState(0)
  const [answers,         setAnswers]        = useState<Record<string, string>>({})
  const [saveStatus,      setSaveStatus]     = useState<SaveStatus>('idle')
  const [lastSavedAt,     setLastSavedAt]    = useState<Date | null>(null)
  const [submitLoading,   setSubmitLoading]  = useState(false)
  const [isSubmitOpen,    setIsSubmitOpen]   = useState(false)
  const [systemCheckPassed, setSystemCheckPassed] = useState(false)

  // Initialize Proctoring Subsystem
  const proctorSessionId = proctoringStatus !== 'UNAVAILABLE' ? proctoringSessionId : null
  const {
    status: proctorStatus,
    cameraActive,
    stream,
    captureFinalSnapshot
  } = useProctoring({
    sessionId: systemCheckPassed ? proctorSessionId : null,
    token,
    proctoringOrigin: window.location.origin.replace(':5173', ':7000')
  })

  // Skip system check automatically if proctoring is unavailable
  useEffect(() => {
    if (proctoringStatus === 'UNAVAILABLE') {
      setSystemCheckPassed(true)
    }
  }, [proctoringStatus])

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const isDirtyRef = useRef(false)

  if (!token) {
    return (
      <div className="error-page" role="alert">
        <div className="error-code">401</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>
          Session Not Found
        </h2>
        <p style={{ color: 'var(--color-muted)', maxWidth: 380 }}>
          Your session has expired or you haven't logged in. Please return to the login page and
          enter your access code.
        </p>
        <button
          className="btn-primary"
          onClick={() => navigate('/login')}
          style={{ marginTop: '0.5rem' }}
        >
          Back to Login
        </button>
      </div>
    )
  }

  const fetchState = useCallback(async () => {
    if (!attemptId || !token) return
    try {
      const data = await api.getAttemptState(attemptId, token)
      setState(data)
      if (data.submitted || data.remainingSeconds <= 0) {
        navigate('/submit-confirm')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load exam state.')
    }
  }, [attemptId, token, navigate])

  const performSave = useCallback(async () => {
    if (!isDirtyRef.current || !attemptId || !token) return
    setSaveStatus('saving')
    try {
      await api.saveAnswers(attemptId, answers, token)
      isDirtyRef.current = false
      setSaveStatus('saved')
      setLastSavedAt(new Date())
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 3000)
    } catch {
      setSaveStatus('failed')
    }
  }, [attemptId, token, answers])

  useEffect(() => {
    fetchState()
    pollRef.current = setInterval(fetchState, 30_000)
    saveRef.current = setInterval(performSave, 30_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (saveRef.current) clearInterval(saveRef.current)
    }
  }, [fetchState, performSave])

  function handleAnswerChange(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    isDirtyRef.current = true
  }

  function goToQuestion(idx: number) {
    if (!state) return
    setQuestionIdx(Math.max(0, Math.min(idx, state.questions.length - 1)))
  }

  async function handleConfirmSubmit() {
    if (!attemptId || !token) return
    setSubmitLoading(true)
    try {
      await api.saveAnswers(attemptId, answers, token).catch(() => {})
      
      // Capture and upload final snapshot (failure is logged and ignored)
      if (proctorSessionId) {
        await captureFinalSnapshot().catch((err) => {
          console.error('[ExamPage] Final snapshot failed:', err)
        })
      }

      await api.submitAttempt(attemptId, token)
      navigate('/submit-confirm')
    } catch {
      setError('Submission failed — please try again or raise your hand.')
    } finally {
      setSubmitLoading(false)
      setIsSubmitOpen(false)
    }
  }

  if (error) {
    return (
      <div className="error-page" role="alert">
        <div className="error-code" style={{ fontSize: '3rem' }}>⚠</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Something went wrong</h2>
        <p style={{ color: 'var(--color-muted)' }}>{error}</p>
        <button className="btn-ghost" onClick={fetchState} style={{ marginTop: '0.5rem' }}>
          Retry
        </button>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="error-page">
        <span className="spinner" style={{ width: 28, height: 28 }} />
        <p style={{ color: 'var(--color-muted)', marginTop: '0.5rem' }}>Loading exam…</p>
      </div>
    )
  }

  if (!systemCheckPassed) {
    return (
      <SystemCheck
        attemptId={attemptId || ''}
        token={token}
        proctoringOrigin={window.location.origin.replace(':5173', ':7000')}
        onComplete={() => setSystemCheckPassed(true)}
      />
    )
  }

  const questions      = state.questions ?? []
  const currentQ       = questions[questionIdx]
  const answeredSet    = new Set(
    questions.map((q, i) => (answers[q.id]?.trim() ? i : -1)).filter((i) => i >= 0)
  )

  return (
    <ProctoringGuard
      status={proctorStatus}
      cameraActive={cameraActive}
      stream={stream}
    >
      <div className="exam-layout">
        {/* ── Header (Matched to Figma specs) ── */}
        <header className="exam-header">
          <div className="exam-header-left">
            <KrsLogo size={26} />
            <span className="exam-logo" style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 300, letterSpacing: '0.04em' }}>
              KRS Assessment Platform
            </span>
          </div>

          <div className="exam-header-center" style={{ flex: 1, overflow: 'hidden' }}>
            <QuestionNav
              total={questions.length}
              current={questionIdx}
              answeredIndices={answeredSet}
              onNavigate={goToQuestion}
            />
          </div>

          <div className="exam-header-right">
            <AutosaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
            <div className="exam-divider" aria-hidden="true" />
            <ExamTimer initialSeconds={state.remainingSeconds} />
            <div className="exam-divider" aria-hidden="true" />
            <button
              id="btn-submit-exam"
              className="btn-primary" /* Styled in gold matching figma Submit button */
              onClick={() => setIsSubmitOpen(true)}
              style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
            >
              Submit
            </button>
          </div>
        </header>

        {/* ── Split IDE Body ── */}
        <div className="exam-body">
          {questions.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)' }}>
              <p style={{ fontSize: '1.1rem' }}>No questions available yet.</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                Please check back shortly or contact your examiner.
              </p>
            </div>
          ) : (
            <QuestionRenderer
              question={currentQ}
              answerValue={answers[currentQ?.id ?? ''] ?? ''}
              onAnswerChange={handleAnswerChange}
            />
          )}
        </div>

        {/* ── Fixed Footer ── */}
        {questions.length > 0 && (
          <footer className="exam-footer">
            <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
              question {questionIdx + 1} of {questions.length}
            </span>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-ghost"
                onClick={() => goToQuestion(questionIdx - 1)}
                disabled={questionIdx === 0}
                style={{ padding: '0.4rem 1.1rem', fontSize: '0.82rem' }}
              >
                &lt; Previous
              </button>

              {questionIdx < questions.length - 1 ? (
                <button
                  className="btn-ghost"
                  onClick={() => goToQuestion(questionIdx + 1)}
                  style={{ padding: '0.4rem 1.1rem', fontSize: '0.82rem' }}
                >
                  Next &gt;
                </button>
              ) : (
                <button
                  id="btn-submit-final"
                  className="btn-danger"
                  onClick={() => setIsSubmitOpen(true)}
                  style={{ padding: '0.4rem 1.1rem', fontSize: '0.82rem' }}
                >
                  Submit &gt;
                </button>
              )}
            </div>
          </footer>
        )}
      </div>

      {/* ── Custom Submit Dialog ── */}
      <SubmitModal
        isOpen={isSubmitOpen}
        onClose={() => setIsSubmitOpen(false)}
        onConfirm={handleConfirmSubmit}
        totalQuestions={questions.length}
        answeredQuestions={answeredSet.size}
        loading={submitLoading}
      />
    </ProctoringGuard>
  )
}
