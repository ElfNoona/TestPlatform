type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

interface Props {
  status: SaveStatus
  lastSavedAt?: Date | null
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * AutosaveIndicator — compact badge showing the current autosave state.
 * idle → invisible, saving → spinner, saved → checkmark + time, failed → warning
 */
export default function AutosaveIndicator({ status, lastSavedAt }: Props) {
  if (status === 'idle') return null

  return (
    <span className={`autosave-indicator ${status}`} role="status" aria-live="polite">
      {status === 'saving' && (
        <>
          <span className="spinner" aria-hidden="true" />
          Saving…
        </>
      )}
      {status === 'saved' && (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {lastSavedAt ? `Saved ${formatTime(lastSavedAt)}` : 'Saved'}
        </>
      )}
      {status === 'failed' && (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6 4v3M6 8.5v.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Save failed
        </>
      )}
    </span>
  )
}

export type { SaveStatus }
