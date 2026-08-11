import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * LoginPage — student enters their exam access code.
 * No self-registration; codes are pre-assigned via admin import.
 *
 * TODO: call POST /api/attempts/start with { code } to get attemptId + JWT
 * TODO: store JWT in memory (not localStorage) and route to /exam/:attemptId
 */
export default function LoginPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // TODO: replace with real API call
      const res = await fetch('/api/attempts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) throw new Error('Invalid code or exam not available')
      const data = await res.json()
      // TODO: persist JWT / attemptId in AuthContext
      navigate(`/exam/${data.attemptId}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <form onSubmit={handleSubmit} style={{ width: 360 }}>
        <h1 style={{ marginBottom: '1.5rem', color: 'var(--color-accent)' }}>KRS Exam</h1>
        <label htmlFor="exam-code" style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-muted)' }}>
          Exam Access Code
        </label>
        <input
          id="exam-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter your code"
          required
          autoFocus
        />
        {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ marginTop: '1rem', width: '100%', background: 'var(--color-accent)', color: '#fff' }}
        >
          {loading ? 'Starting…' : 'Start Exam'}
        </button>
      </form>
    </div>
  )
}
