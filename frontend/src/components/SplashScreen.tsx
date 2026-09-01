import { useState, useEffect } from 'react'
import KrsLogo from './KrsLogo'

interface SplashScreenProps {
  onComplete: () => void
  duration?: number
}

const STEPS = [
  'Initializing secure environment…',
  'Loading assessment modules…',
  'Establishing proctoring channel…',
  'Almost ready…',
]

export default function SplashScreen({ onComplete, duration = 2400 }: SplashScreenProps) {
  const [exiting, setExiting] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1))
    }, duration / STEPS.length)
    return () => clearInterval(interval)
  }, [duration])

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), duration)
    const removeTimer = setTimeout(() => onComplete(), duration + 400)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(removeTimer)
    }
  }, [duration, onComplete])

  return (
    <div className={`splash-screen${exiting ? ' exiting' : ''}`} role="dialog" aria-modal="true" aria-label="Loading KRS Exam Platform">
      {/* Background grids */}
      <div className="splash-grid" aria-hidden="true" />
      {/* Glow shaders */}
      <div className="splash-glow-orb top-left" aria-hidden="true" />
      <div className="splash-glow-orb bottom-right" aria-hidden="true" />

      <div className="splash-content">
        {/* Large KRS Display Logo */}
        <div className="splash-logo-container" style={{ width: 220, height: 220, marginBottom: '0.5rem' }}>
          <KrsLogo className="login-emblem-svg" size="100%" />
        </div>

        {/* Progress tracker bar */}
        <div className="splash-progress-track" role="progressbar" aria-label="Loading progress">
          <div className="splash-progress-bar" />
        </div>

        {/* Status code step description */}
        <p className="splash-shimmer-text" key={stepIdx}>
          {STEPS[stepIdx]}
        </p>
      </div>
    </div>
  )
}
