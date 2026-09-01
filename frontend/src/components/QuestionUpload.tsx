import { useState } from 'react'

interface QuestionUploadProps {
  token: string
  onSuccess?: (questionSetId: string, name: string) => void
}

type QuestionType = 'mcq' | 'output-prediction' | 'coding' | 'debug'

interface ValidationError {
  index: number
  field: string
  message: string
}

const QUESTION_TEMPLATES: Record<QuestionType, object> = {
  mcq: {
    type: 'mcq',
    prompt: 'Which of the following is the correct way to declare a nullable String in Dart?',
    options: ['String name;', 'String? name;', 'nullable String name;', 'String name = null;'],
    correct_answer: 'String? name;',
    marks: 2,
    order_index: 0,
  },
  'output-prediction': {
    type: 'output-prediction',
    prompt: 'What does the following Dart program print?\n```dart\nvoid main() {\n  var items = [1,2,3];\n  print(items.map((x) => x * 2).toList());\n}\n```',
    starter_code: 'void main() {\n  var items = [1,2,3];\n  print(items.map((x) => x * 2).toList());\n}',
    correct_answer: '[2, 4, 6]',
    marks: 3,
    order_index: 1,
  },
  coding: {
    type: 'coding',
    prompt: 'Write a Dart function `int sumList(List<int> nums)` that returns the sum of all integers in the list. Handle empty lists by returning 0.',
    starter_code: 'int sumList(List<int> nums) {\n  // TODO: implement\n}',
    marks: 10,
    evaluation: {
      language: 'dart',
      evaluation_type: 'compiler_tests',
      evaluation_config_id: 'eval_dart_sumlist_v1',
    },
    order_index: 2,
  },
  debug: {
    type: 'debug',
    prompt: 'The following Dart function has a bug. Identify and fix it so all test cases pass.',
    starter_code: 'int factorial(int n) {\n  if (n == 0) return 0; // BUG\n  return n * factorial(n - 1);\n}',
    marks: 8,
    evaluation: {
      language: 'dart',
      evaluation_type: 'compiler_tests',
      evaluation_config_id: 'eval_dart_factorial_debug_v1',
    },
    order_index: 3,
  },
}

export default function QuestionUpload({ token, onSuccess }: QuestionUploadProps) {
  const [step, setStep] = useState<'name' | 'upload' | 'uploading' | 'done'>('name')
  const [setName, setSetName] = useState('')
  const [createdSetId, setCreatedSetId] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<{ count: number } | null>(null)
  const [serverErrors, setServerErrors] = useState<string[] | null>(null)
  const [activeTemplate, setActiveTemplate] = useState<QuestionType | null>(null)
  const [isCreatingSet, setIsCreatingSet] = useState(false)

  // ── Step 1: Create question set ───────────────────────────────────────────
  async function handleCreateSet() {
    if (!setName.trim()) return
    setIsCreatingSet(true)
    try {
      const res = await fetch('/api/admin/question-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: setName.trim() })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const { questionSet } = await res.json()
      setCreatedSetId(questionSet.id)
      setStep('upload')
    } catch (err: any) {
      setParseError(`Failed to create question set: ${err.message}`)
    } finally {
      setIsCreatingSet(false)
    }
  }

  // ── Step 2: Validate JSON client-side before uploading ────────────────────
  function validateJson(text: string): { questions: any[]; errors: ValidationError[] } | null {
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch (e: any) {
      setParseError(`Invalid JSON: ${e.message}`)
      return null
    }
    setParseError(null)

    const questions: any[] = Array.isArray(parsed) ? parsed : parsed.questions
    if (!Array.isArray(questions)) {
      setParseError('JSON must be an array of questions, or an object with a "questions" array.')
      return null
    }

    const errors: ValidationError[] = []
    const validTypes = ['mcq', 'output-prediction', 'coding', 'debug']

    questions.forEach((q, i) => {
      if (!validTypes.includes(q.type)) {
        errors.push({ index: i, field: 'type', message: `Invalid type "${q.type}"` })
      }
      if (!q.prompt?.trim()) {
        errors.push({ index: i, field: 'prompt', message: 'prompt is required' })
      }
      if (typeof q.marks !== 'number' || q.marks < 0) {
        errors.push({ index: i, field: 'marks', message: 'marks must be a non-negative number' })
      }
      if (q.type === 'mcq') {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push({ index: i, field: 'options', message: 'MCQ requires at least 2 options' })
        }
        if (!q.correct_answer) {
          errors.push({ index: i, field: 'correct_answer', message: 'MCQ requires correct_answer' })
        }
      }
      if (q.type === 'output-prediction' && !q.correct_answer) {
        errors.push({ index: i, field: 'correct_answer', message: 'output-prediction requires correct_answer' })
      }
      if (q.type === 'coding' || q.type === 'debug') {
        if (!q.evaluation?.evaluation_config_id) {
          errors.push({ index: i, field: 'evaluation.evaluation_config_id', message: 'coding/debug requires evaluation.evaluation_config_id' })
        }
      }
    })

    return { questions, errors }
  }

  // ── Step 3: Upload to backend ─────────────────────────────────────────────
  async function handleUpload() {
    setValidationErrors([])
    setServerErrors(null)
    setUploadResult(null)

    const validated = validateJson(jsonText)
    if (!validated) return
    if (validated.errors.length > 0) {
      setValidationErrors(validated.errors)
      return
    }

    setStep('uploading')
    try {
      const res = await fetch(`/api/admin/question-sets/${createdSetId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ questions: validated.questions })
      })
      const data = await res.json()
      if (!res.ok) {
        setServerErrors(data.details || [data.error])
        setStep('upload')
        return
      }
      setUploadResult({ count: data.questions.length })
      onSuccess?.(createdSetId!, setName)
      setStep('done')
    } catch (err: any) {
      setServerErrors([err.message])
      setStep('upload')
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setJsonText(ev.target?.result as string || '')
    }
    reader.readAsText(file)
  }

  function insertTemplate(type: QuestionType) {
    const template = QUESTION_TEMPLATES[type]
    try {
      let existing: any[] = []
      if (jsonText.trim()) {
        const parsed = JSON.parse(jsonText)
        existing = Array.isArray(parsed) ? parsed : (parsed.questions || [])
      }
      existing.push(template)
      setJsonText(JSON.stringify(existing, null, 2))
      setActiveTemplate(type)
    } catch {
      setJsonText(JSON.stringify([template], null, 2))
    }
  }

  const CONTAINER: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
    width: '100%', maxWidth: '760px', margin: '0 auto',
  }
  const CARD: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '1.5rem',
  }

  return (
    <div style={CONTAINER}>
      {/* ── Step 1: Name ── */}
      <div style={CARD}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
          1 — Create Question Set
        </h3>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="qset-name" style={{ fontSize: '0.78rem', color: 'var(--color-muted)', display: 'block', marginBottom: '0.4rem' }}>
              Question Set Name
            </label>
            <input
              id="qset-name"
              className="input"
              type="text"
              placeholder="e.g. Batch A — Dart Fundamentals"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              disabled={step !== 'name'}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateSet()}
              style={{ width: '100%' }}
            />
          </div>
          <button
            className="btn-primary"
            onClick={handleCreateSet}
            disabled={!setName.trim() || isCreatingSet || step !== 'name'}
            style={{ whiteSpace: 'nowrap', padding: '0.55rem 1.25rem' }}
          >
            {isCreatingSet ? 'Creating…' : 'Create Set'}
          </button>
        </div>
        {step !== 'name' && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            Set created: <strong>{setName}</strong>
          </p>
        )}
      </div>

      {/* ── Step 2: Upload Questions ── */}
      {(step === 'upload' || step === 'uploading' || step === 'done') && (
        <div style={CARD}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
            2 — Upload Questions (JSON)
          </h3>

          {/* Template Buttons */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
              Insert template:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(['mcq', 'output-prediction', 'coding', 'debug'] as QuestionType[]).map((type) => (
                <button
                  key={type}
                  className="btn-ghost"
                  onClick={() => insertTemplate(type)}
                  disabled={step === 'done'}
                  style={{
                    fontSize: '0.72rem', padding: '0.3rem 0.75rem',
                    borderColor: activeTemplate === type ? 'var(--color-accent)' : undefined,
                    color: activeTemplate === type ? 'var(--color-accent)' : undefined,
                  }}
                >
                  + {type}
                </button>
              ))}
            </div>
          </div>

          {/* File Upload or Text Area */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                disabled={step === 'done'}
              />
              <span className="btn-ghost" style={{ fontSize: '0.72rem', padding: '0.3rem 0.75rem', pointerEvents: 'none' }}>
                📁 Load from file
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-faint)' }}>(.json)</span>
            </label>

            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              disabled={step === 'done' || step === 'uploading'}
              rows={16}
              spellCheck={false}
              placeholder={'[\n  {\n    "type": "mcq",\n    "prompt": "...",\n    "options": ["A", "B", "C", "D"],\n    "correct_answer": "B",\n    "marks": 2\n  }\n]'}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--color-bg-deep)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '0.75rem 1rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.73rem',
                color: 'var(--color-text)',
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
          </div>

          {/* Validation Errors */}
          {parseError && (
            <div style={{ marginTop: '0.75rem', padding: '0.65rem 1rem', background: 'rgba(209,69,56,0.08)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--color-danger)' }}>
              {parseError}
            </div>
          )}
          {validationErrors.length > 0 && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(209,69,56,0.06)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-danger)', margin: '0 0 0.5rem' }}>
                {validationErrors.length} validation error(s):
              </p>
              <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.72rem', color: 'var(--color-danger)' }}>
                {validationErrors.map((err, i) => (
                  <li key={i}>Q[{err.index}] <strong>{err.field}</strong>: {err.message}</li>
                ))}
              </ul>
            </div>
          )}
          {serverErrors && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(209,69,56,0.06)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-danger)', margin: '0 0 0.5rem' }}>Server rejected upload:</p>
              <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.72rem', color: 'var(--color-danger)' }}>
                {serverErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {step !== 'done' && (
            <button
              className="btn-primary"
              onClick={handleUpload}
              disabled={!jsonText.trim() || step === 'uploading'}
              style={{ marginTop: '1rem', padding: '0.65rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {step === 'uploading' ? (
                <><span className="spinner" style={{ width: 12, height: 12 }} /> Uploading…</>
              ) : (
                <>Upload Questions</>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && uploadResult && (
        <div style={{ ...CARD, borderColor: 'var(--color-success)', background: 'rgba(118,199,192,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-success)', fontSize: '0.9rem' }}>
                {uploadResult.count} question{uploadResult.count !== 1 ? 's' : ''} uploaded successfully
              </p>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Set "<strong>{setName}</strong>" is now in draft state. Publish it from the question sets list when ready.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
