import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import ExamTimer from '../components/ExamTimer'
import QuestionRenderer from '../components/QuestionRenderer'

/**
 * ExamPage — the main exam runner.
 *
 * Timer strategy (IMPORTANT):
 *   - Client countdown is COSMETIC ONLY — display only.
 *   - Source of truth is GET /api/attempts/:id/state which returns
 *     { remainingSeconds, submitted, currentQuestion, ... }.
 *   - Poll every 30 s; if remainingSeconds ≤ 0, auto-submit.
 *   - Server enforces cutoff regardless of client state.
 *
 * TODO: implement autosave (POST /api/attempts/:id/answers every N seconds)
 * TODO: implement question navigation (multi-question sets)
 * TODO: handle session expiry / tab visibility events
 * TODO: wire up Monaco editor for code-answer questions via QuestionRenderer
 */

interface AttemptState {
  remainingSeconds: number
  submitted: boolean
  questions: unknown[]  // TODO: define Question type
  // TODO: expand shape as backend schema is defined
}

export default function ExamPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<AttemptState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchState() {
    try {
      const res = await fetch(`/api/attempts/${attemptId}/state`, {
        // TODO: attach JWT from AuthContext
      })
      if (!res.ok) throw new Error('Failed to fetch exam state')
      const data: AttemptState = await res.json()
      setState(data)
      if (data.submitted || data.remainingSeconds <= 0) {
        // Server says time's up — redirect to confirmation
        navigate('/submit-confirm')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    fetchState()
    // Poll every 30 seconds — cosmetic countdown is handled inside ExamTimer
    pollRef.current = setInterval(fetchState, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [attemptId])

  async function handleSubmit() {
    if (!window.confirm('Submit your exam? This cannot be undone.')) return
    try {
      await fetch(`/api/attempts/${attemptId}/submit`, {
        method: 'POST',
        // TODO: attach JWT
      })
      navigate('/submit-confirm')
    } catch {
      setError('Submit failed — please try again or raise your hand.')
    }
  }

  if (error) return <div style={{ padding: '2rem', color: 'var(--color-danger)' }}>{error}</div>
  if (!state) return <div style={{ padding: '2rem', color: 'var(--color-muted)' }}>Loading exam…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header bar with timer */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)' }}>
        <span style={{ fontWeight: 600 }}>KRS Exam</span>
        <ExamTimer initialSeconds={state.remainingSeconds} />
        <button onClick={handleSubmit} style={{ background: 'var(--color-danger)', color: '#fff' }}>
          Submit Exam
        </button>
      </header>

      {/* Question area */}
      <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
        {/* TODO: render question list / navigation */}
        <QuestionRenderer question={state.questions[0]} />
      </main>
    </div>
  )
}
