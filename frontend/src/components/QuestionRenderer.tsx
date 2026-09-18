import { useEffect, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, type Question } from '../utils/api'

interface Props {
  question: Question | undefined
  answerValue: string
  onAnswerChange: (questionId: string, answer: string) => void
}

function useDartLanguage(monaco: ReturnType<typeof useMonaco>) {
  const registered = useRef(false)
  useEffect(() => {
    if (!monaco || registered.current) return
    registered.current = true

    monaco.languages.register({ id: 'dart' })
    monaco.languages.setMonarchTokensProvider('dart', {
      keywords: [
        'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch',
        'class', 'const', 'continue', 'covariant', 'default', 'deferred', 'do',
        'dynamic', 'else', 'enum', 'export', 'extends', 'extension', 'external',
        'factory', 'false', 'final', 'finally', 'for', 'Function', 'get', 'hide',
        'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
        'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow',
        'return', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this',
        'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield',
      ],
      builtins: ['print', 'List', 'Map', 'Set', 'String', 'int', 'double', 'bool',
                 'num', 'Object', 'Iterable', 'Future', 'Stream', 'DateTime'],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/\/\*/, { token: 'comment', next: '@blockComment' }],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/r"[^"]*"/, 'string'],
          [/r'[^']*'/, 'string'],
          [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
          [/\b\d+\.?\d*([eE][+-]?\d+)?\b/, 'number'],
          [/\b([a-zA-Z_$][\w$]*)\b/, {
            cases: {
              '@keywords': 'keyword',
              '@builtins': 'type',
              '@default': 'identifier',
            },
          }],
          [/[{}()\[\]]/, 'delimiter.bracket'],
          [/[;,.]/, 'delimiter'],
          [/[<>]=?|[!=]=?=?|&&|\|\||[+\-*/%&|^~?:]/, 'operator'],
        ],
        blockComment: [
          [/[^/*]+/, 'comment'],
          [/\*\//, { token: 'comment', next: '@pop' }],
          [/[/*]/, 'comment'],
        ],
      },
    })

    monaco.editor.defineTheme('krs-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword',    foreground: 'e8c47d', fontStyle: 'bold' },
        { token: 'type',       foreground: '70c5c5' },
        { token: 'string',     foreground: 'a8dca8' },
        { token: 'comment',    foreground: '5c6a80', fontStyle: 'italic' },
        { token: 'number',     foreground: 'e8a37d' },
        { token: 'number.hex', foreground: 'e8a37d' },
        { token: 'operator',   foreground: 'b8c8d8' },
        { token: 'identifier', foreground: 'dcdce0' },
        { token: 'delimiter.bracket', foreground: 'e8c47d' },
      ],
      colors: {
        'editor.background':           '#121211', /* Lacquer deep ground from screenshots */
        'editor.foreground':           '#E2E2E0',
        'editor.lineHighlightBackground': '#1C1C1B',
        'editorLineNumber.foreground': '#4E4E4A',
        'editorLineNumber.activeForeground': '#E6C15A',
        'editor.selectionBackground':  'rgba(230, 193, 90, 0.16)',
        'editorGutter.background':     '#121211',
        'editorWidget.background':     '#262624',
        'editorSuggestWidget.background': '#262624',
        'editorSuggestWidget.border':  'rgba(230, 193, 90, 0.12)',
      },
    })
  }, [monaco])
}

export default function QuestionRenderer({ question, answerValue, onAnswerChange }: Props) {
  const monaco = useMonaco()
  useDartLanguage(monaco)

  const { attemptId } = useParams<{ attemptId: string }>()
  const { token } = useAuth()

  const [selectedOption, setSelectedOption] = useState<string>(answerValue ?? '')
  const [runState, setRunState] = useState<'idle' | 'running' | 'completed' | 'error'>('idle')
  const [runResults, setRunResults] = useState<any[] | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const activeJobIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSelectedOption(answerValue ?? '')
    // Reset run state on question change
    setRunState('idle')
    setRunResults(null)
    setRunError(null)
    if (pollingRef.current) clearInterval(pollingRef.current)
  }, [answerValue, question?.id])

  async function handleRunCode() {
    if (!question || !attemptId || !token) return
    const codeToRun = question.type === 'output-prediction' ? question.starterCode : answerValue
    if (!codeToRun) return

    setRunState('running')
    setRunResults(null)
    setRunError(null)

    try {
      const { jobId } = await api.runCode(attemptId, question.id, codeToRun, 'dart', token)
      activeJobIdRef.current = jobId

      if (pollingRef.current) clearInterval(pollingRef.current)
      
      pollingRef.current = setInterval(async () => {
        if (activeJobIdRef.current !== jobId) {
          // Stale execution, ignore
          clearInterval(pollingRef.current!)
          return
        }
        
        try {
          const res = await api.getRunCodeStatus(attemptId, jobId, token)
          if (res.status === 'completed' || res.status === 'failed') {
            if (activeJobIdRef.current !== jobId) return // double check
            clearInterval(pollingRef.current!)
            setRunState(res.status === 'completed' ? 'completed' : 'error')
            if (res.result && res.result.results) {
               setRunResults(res.result.results)
            } else {
               setRunError(res.error || 'Execution failed')
            }
          }
        } catch (err) {
          // Network error while polling, wait for next tick
        }
      }, 1500)
    } catch (err: any) {
      setRunState('error')
      setRunError(err.message || 'Failed to enqueue execution')
    }
  }

  if (!question) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--color-muted)' }}>
        <span className="spinner" style={{ width: 18, height: 18, marginRight: '0.75rem' }} />
        Loading question…
      </div>
    )
  }

  const showEditor = question.type === 'coding' || question.type === 'debug' || question.type === 'output-prediction'

  // Map file extension labels based on question type
  const fileTabLabel = question.type === 'coding' ? 'main.dart' :
                       question.type === 'debug' ? 'debug_test.dart' : 'prediction_test.dart'

  return (
    <div className="split-pane-container">
      {/* ── Left Pane: Question Description ── */}
      <div className="split-pane-left" style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
        {/* Pinned high-tech background watermark */}
        <div style={{ position: 'absolute', bottom: -20, left: -20, width: 240, height: 240, pointerEvents: 'none', opacity: 0.08, zIndex: 0 }}>
          <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="95" stroke="var(--color-accent)" strokeWidth="0.5" strokeDasharray="4 8" opacity="0.3" />
            <circle cx="100" cy="100" r="80" stroke="var(--color-accent)" strokeWidth="1" opacity="0.5" />
            <path d="M 100 10 A 90 90 0 0 1 190 100" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 100 190 A 90 90 0 0 1 10 100" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 100 35 L 155 55 V 105 C 155 140 100 168 100 168 C 100 166 45 140 45 105 V 55 Z" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M 100 55 V 90" stroke="var(--color-accent)" strokeWidth="1.2" />
            <circle cx="100" cy="90" r="3" fill="var(--color-accent)" />
            <path d="M 70 75 H 90 L 100 85" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="70" cy="75" r="2.5" fill="var(--color-accent)" />
            <path d="M 130 75 H 110 L 100 85" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="130" cy="75" r="2.5" fill="var(--color-accent)" />
            <path d="M 60 115 L 80 115 L 95 100" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="60" cy="115" r="2.5" fill="var(--color-accent)" />
            <path d="M 140 115 L 120 115 L 105 100" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="140" cy="115" r="2.5" fill="var(--color-accent)" />
            <path d="M 100 145 V 120" stroke="var(--color-accent)" strokeWidth="1.2" />
            <circle cx="100" cy="120" r="3" fill="var(--color-accent)" />
            <circle cx="100" cy="103" r="14" stroke="var(--color-accent)" strokeWidth="1.5" fill="var(--color-bg)" />
            <circle cx="100" cy="103" r="6" fill="var(--color-accent)" />
          </svg>
        </div>

        {/* Scrollable description content */}
        <div style={{ height: '100%', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative', zIndex: 1 }}>
          <div className="pane-header" style={{ margin: '-1.5rem -1.5rem 0 -1.5rem', flexShrink: 0 }}>
            <div className="pane-tab active">Description</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>
              {question.type}
            </span>
          </div>

          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'var(--color-text)' }}>
            {question.prompt}
          </p>
        </div>
      </div>

      {/* ── Right Pane: Code Editor or Interactive Inputs ── */}
      <div className="split-pane-right">
        <div className="pane-header">
          <div className="pane-tab active">
            {showEditor ? fileTabLabel : 'Selection Area'}
          </div>
        </div>

        {showEditor ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Editor
                height="100%"
                language="dart"
                theme="krs-dark"
                defaultValue={question.starterCode ?? '// Write your Dart code here\n'}
                value={question.type !== 'output-prediction' ? (answerValue || question.starterCode || '') : undefined}
                options={{
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  readOnly: question.type === 'output-prediction',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: 'line',
                  cursorBlinking: 'smooth',
                  smoothScrolling: true,
                  wordWrap: 'on',
                }}
                onChange={(val) => {
                  if (question.type !== 'output-prediction') {
                    onAnswerChange(question.id, val ?? '')
                  }
                }}
              />
            </div>

            {/* Bottom status/logs panel on the right pane */}
            <div className="pane-status-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="btn-primary" onClick={handleRunCode} disabled={runState === 'running'} style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}>
                  {runState === 'running' ? 'Running...' : 'Run / Test Code'}
                </button>
                {runState === 'error' && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{runError || 'Execution Failed'}</span>}
                {runState === 'completed' && <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>Execution Complete</span>}
              </div>
              <div className="proctoring-badge">
                <span className="dot" />
                Proctoring Active
              </div>
            </div>

            {/* Run Results Display */}
            {runResults && (
              <div style={{ padding: '1rem', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', flexShrink: 0, overflowY: 'auto', maxHeight: '35%' }}>
                 <h4 style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Execution Results:</h4>
                 {runResults.map((res: any, idx: number) => (
                   <div key={idx} style={{ marginBottom: '0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', borderLeft: `3px solid ${res.status?.id === 3 ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
                     <div style={{ fontWeight: 600, color: 'var(--color-text-strong)', marginBottom: '0.25rem' }}>
                       Test Case {idx + 1}: {res.status?.description || res.error}
                     </div>
                     {res.stdout && <div style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{res.stdout}</div>}
                     {res.stderr && <div style={{ color: 'var(--color-danger)', whiteSpace: 'pre-wrap' }}>{res.stderr}</div>}
                     {res.compile_output && <div style={{ color: 'var(--color-warning)', whiteSpace: 'pre-wrap' }}>{res.compile_output}</div>}
                   </div>
                 ))}
              </div>
            )}


            {question.type === 'output-prediction' && (
              <div style={{
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                padding: '1.25rem',
                flexShrink: 0,
              }}>
                <label
                  htmlFor={`answer-${question.id}`}
                  style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.72rem',
                    color: 'var(--color-text-strong)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  Expected stdout:
                </label>
                <textarea
                  id={`answer-${question.id}`}
                  rows={4}
                  value={answerValue}
                  onChange={(e) => onAnswerChange(question.id, e.target.value)}
                  placeholder="Enter stdout text here…"
                  spellCheck={false}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'none' }}
                />
              </div>
            )}
          </div>
        ) : (
          /* MCQ Selection Area */
          <div style={{ padding: '2rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span style={{ color: 'var(--color-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '0.25rem' }}>
              Choose one option:
            </span>
            {question.options && question.options.map((opt, i) => {
              const isSelected = selectedOption === opt
              return (
                <label
                  key={i}
                  htmlFor={`mcq-${question.id}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    cursor: 'pointer',
                    padding: '0.8rem 1.25rem',
                    background: isSelected ? 'rgba(230, 193, 90, 0.05)' : 'var(--color-surface)',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    transition: 'all var(--transition)',
                    userSelect: 'none',
                  }}
                >
                  <input
                    id={`mcq-${question.id}-${i}`}
                    type="radio"
                    name={`mcq-${question.id}`}
                    value={opt}
                    checked={isSelected}
                    onChange={() => {
                      setSelectedOption(opt)
                      onAnswerChange(question.id, opt)
                    }}
                    style={{ width: 'auto', accentColor: 'var(--color-accent)' }}
                  />
                  <span style={{ fontSize: '0.9rem', color: isSelected ? 'var(--color-accent)' : 'var(--color-text)' }}>{opt}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
