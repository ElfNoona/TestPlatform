interface Props {
  /** Total number of questions */
  total: number
  /** Currently displayed question index (0-based) */
  current: number
  /** Set of question indices that have a non-empty answer */
  answeredIndices: Set<number>
  /** Called when a nav button is clicked */
  onNavigate: (index: number) => void
}

/**
 * QuestionNav — a horizontal strip of numbered buttons, one per question.
 * Answered questions are highlighted green; active is highlighted accent.
 */
export default function QuestionNav({ total, current, answeredIndices, onNavigate }: Props) {
  if (total === 0) return null

  return (
    <nav className="question-nav" aria-label="Question navigation">
      {Array.from({ length: total }, (_, i) => {
        const isActive   = i === current
        const isAnswered = answeredIndices.has(i)
        const classes    = [
          'question-nav-btn',
          isActive   ? 'active'   : '',
          isAnswered ? 'answered' : '',
        ].filter(Boolean).join(' ')

        return (
          <button
            key={i}
            className={classes}
            onClick={() => onNavigate(i)}
            aria-label={`Question ${i + 1}${isAnswered ? ' (answered)' : ''}`}
            aria-current={isActive ? 'true' : undefined}
          >
            {i + 1}
          </button>
        )
      })}
    </nav>
  )
}
