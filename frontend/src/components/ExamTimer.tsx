import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Remaining seconds as reported by the server (source of truth). */
  initialSeconds: number
  /** Callback triggered when countdown hits zero */
  onTimeUp?: () => void
}

/**
 * ExamTimer — cosmetic countdown only.
 * The displayed time counts down from `initialSeconds` locally.
 * The parent (ExamPage) polls the server every 30 s and updates this via
 * a key prop or re-render with the fresh server value.
 *
 * NOTE: This component does NOT govern when the exam ends — that is
 * enforced server-side. This is display only.
 */
export default function ExamTimer({ initialSeconds, onTimeUp }: Props) {
  const [remaining, setRemaining] = useState(initialSeconds)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset when server gives us a fresh value
  useEffect(() => { setRemaining(initialSeconds) }, [initialSeconds])

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onTimeUp?.()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const hours   = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = remaining % 60
  const label   = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  const isLow   = remaining < 300  // < 5 minutes

  return (
    <span
      aria-label={`Time remaining: ${label}`}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '1.25rem',
        fontWeight: 700,
        color: isLow ? 'var(--color-danger)' : 'var(--color-accent-2)',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </span>
  )
}
