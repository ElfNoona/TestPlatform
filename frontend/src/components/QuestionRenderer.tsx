import Editor from '@monaco-editor/react'

// TODO: define the full Question union type once backend schema is finalised
interface Question {
  id: string
  type: 'mcq' | 'output-prediction' | 'debug' | 'coding'
  prompt: string
  starterCode?: string
  options?: string[]  // MCQ options
  // TODO: expand as spec is clarified
}

interface Props {
  question: unknown
}

/**
 * QuestionRenderer — renders the correct input UI based on question type.
 *
 * - mcq:               radio buttons
 * - output-prediction: Monaco editor (read-only code) + text answer input
 * - debug:             Monaco editor (editable) 
 * - coding:            Monaco editor (editable, full solution)
 *
 * Monaco is configured with Dart language mode.
 * TODO: register Dart syntax highlighting (Monaco doesn't ship Dart by default)
 *       — use a community grammar or TextMate bundle.
 * TODO: wire answer changes back up to ExamPage → autosave
 */
export default function QuestionRenderer({ question }: Props) {
  if (!question) {
    return <p style={{ color: 'var(--color-muted)' }}>Loading question…</p>
  }

  const q = question as Question

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)',
        padding: '1.25rem', border: '1px solid var(--color-border)' }}>
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{q.prompt}</p>
      </div>

      {(q.type === 'coding' || q.type === 'debug' || q.type === 'output-prediction') && (
        <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden',
          border: '1px solid var(--color-border)' }}>
          <Editor
            height="400px"
            defaultLanguage="dart"
            /* TODO: register Dart grammar — placeholder uses 'dart' token */
            theme="vs-dark"
            defaultValue={q.starterCode ?? '// Write your Dart code here\n'}
            options={{
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              readOnly: q.type === 'output-prediction',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
            }}
            /* TODO: onChange → debounce → call autosave */
          />
        </div>
      )}

      {q.type === 'output-prediction' && (
        <div>
          <label htmlFor={`answer-${q.id}`} style={{ display: 'block', marginBottom: '0.5rem',
            color: 'var(--color-muted)', fontSize: '0.9rem' }}>
            What will this code print? (exact output)
          </label>
          <textarea
            id={`answer-${q.id}`}
            rows={4}
            placeholder="Enter expected output…"
            style={{ fontFamily: 'var(--font-mono)' }}
            /* TODO: onChange → autosave */
          />
        </div>
      )}

      {q.type === 'mcq' && q.options && (
        <fieldset style={{ border: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <legend style={{ color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
            Choose one:
          </legend>
          {q.options.map((opt, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
              cursor: 'pointer', padding: '0.6rem 1rem',
              background: 'var(--color-surface)', borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)' }}>
              <input type="radio" name={`mcq-${q.id}`} value={opt}
                /* TODO: onChange → autosave */ />
              <span>{opt}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
