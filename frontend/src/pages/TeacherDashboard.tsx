import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import KrsLogo from '../components/KrsLogo'
import QuestionUpload from '../components/QuestionUpload'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string
  name: string
  access_code: string
  slot_id: string | null
  question_set_id: string | null
  attemptId?: string
  attemptStatus?: 'active' | 'submitted' | null
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null
  proctoringSessionId?: string | null
}

interface QuestionSet {
  id: string
  name: string
  version: number
  status: 'draft' | 'published' | 'archived'
  question_count: number
  created_at: string
  published_at: string | null
}

type TabId = 'candidates' | 'question-sets' | 'upload'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function getAvatarBg(name: string) {
  const colors = [
    'rgba(197, 160, 58, 0.15)', // Gold
    'rgba(118, 199, 192, 0.15)', // Patina
    'rgba(209, 69, 56, 0.15)',  // Vermilion
    'rgba(224, 112, 48, 0.15)',  // Orange
  ]
  let sum = 0
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i)
  return colors[sum % colors.length]
}

function riskBadgeStyles(level?: string | null) {
  switch (level) {
    case 'CRITICAL':
      return {
        color: 'var(--color-danger)',
        background: 'rgba(209,69,56,0.1)',
        border: '1px solid rgba(209,69,56,0.25)',
        boxShadow: '0 0 8px rgba(209,69,56,0.2)',
      }
    case 'HIGH':
      return {
        color: '#e07030',
        background: 'rgba(224,112,48,0.1)',
        border: '1px solid rgba(224,112,48,0.25)',
      }
    case 'MEDIUM':
      return {
        color: 'var(--color-warning)',
        background: 'rgba(230,193,90,0.1)',
        border: '1px solid rgba(230,193,90,0.25)',
      }
    case 'LOW':
      return {
        color: 'var(--color-success)',
        background: 'rgba(118,199,192,0.1)',
        border: '1px solid rgba(118,199,192,0.25)',
      }
    default:
      return {
        color: 'var(--color-muted)',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--color-border)',
      }
  }
}

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const [teacherToken] = useState<string | null>(() => localStorage.getItem('teacher_token'))

  const [activeTab, setActiveTab] = useState<TabId>('candidates')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)

  const isMockMode = teacherToken === 'mock-teacher-token'

  // ── Data Loading ────────────────────────────────────────────────────────────
  async function fetchCandidates() {
    if (!teacherToken) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/students', {
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      setCandidates(data.students || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchQuestionSets() {
    if (!teacherToken) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/question-sets', {
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      setQuestionSets(data.questionSets || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handlePublish(setId: string) {
    if (!teacherToken) return
    setPublishingId(setId)
    try {
      const res = await fetch(`/api/admin/question-sets/${setId}/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Failed (${res.status})`)
      }
      await fetchQuestionSets()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPublishingId(null)
    }
  }

  useEffect(() => {
    if (activeTab === 'candidates') fetchCandidates()
    if (activeTab === 'question-sets') fetchQuestionSets()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layout helpers ──────────────────────────────────────────────────────────
  if (!teacherToken) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1.5rem', background: 'var(--color-bg-deep)', color: 'var(--color-muted)', fontFamily: 'var(--font-sans)', padding: '2rem' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-10px', background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)', filter: 'blur(15px)', opacity: 0.15 }} />
          <KrsLogo size={80} />
        </div>
        <h2 style={{ color: 'var(--color-text-strong)', fontWeight: 500, letterSpacing: '0.02em', fontSize: '1.3rem' }}>Teacher Authentication Required</h2>
        <p style={{ fontSize: '0.82rem', maxWidth: 380, textAlign: 'center', lineHeight: 1.6, color: 'var(--color-muted)' }}>
          Please go back to the login screen and toggle the Teacher Portal to enter using your teacher access code.
        </p>
        <button className="btn-ghost" onClick={() => navigate('/login')} style={{ marginTop: '0.5rem', padding: '0.5rem 1.5rem', fontSize: '0.8rem' }}>
          ← Back to Login
        </button>
      </div>
    )
  }

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'candidates',
      label: 'Candidates',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    {
      id: 'question-sets',
      label: 'Question Sets',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      )
    },
    {
      id: 'upload',
      label: 'Upload Questions',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )
    },
  ]

  // KPI Calculations
  const activeCount = candidates.filter((c) => c.attemptStatus === 'active').length
  const submittedCount = candidates.filter((c) => c.attemptStatus === 'submitted').length
  const criticalCount = candidates.filter((c) => c.riskLevel === 'CRITICAL' || c.riskLevel === 'HIGH').length
  const completionRate = candidates.length > 0 ? Math.round((submittedCount / candidates.length) * 100) : 0

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: '1.25rem',
        padding: '0.85rem 1.75rem',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}>
        <KrsLogo size={28} />
        <span style={{ fontFamily: 'var(--font-wordmark)', fontSize: '1.25rem', fontWeight: 600, letterSpacing: '0.04em', color: 'var(--color-text-strong)' }}>
          KRS Assessment
        </span>
        <div style={{ height: '18px', width: '1px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)', fontWeight: 500 }}>
          TEACHER CONSOLE
        </span>
        
        {isMockMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            background: 'rgba(230, 193, 90, 0.06)',
            border: '1px solid rgba(230, 193, 90, 0.2)',
            padding: '0.2rem 0.6rem',
            borderRadius: '100px',
            fontSize: '0.68rem',
            color: 'var(--color-accent)',
            fontWeight: 600,
            letterSpacing: '0.03em',
            boxShadow: '0 0 10px rgba(230,193,90,0.05)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-accent)', display: 'inline-block', boxShadow: '0 0 6px var(--color-accent)' }} />
            DEMO MODE (IN-MEMORY STORAGE ACTIVE)
          </div>
        )}

        <div style={{ flex: 1 }} />
        
        <button
          className="btn-ghost"
          onClick={() => {
            localStorage.removeItem('teacher_token')
            navigate('/login')
          }}
          style={{ fontSize: '0.78rem', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Log Out
        </button>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* ── Sidebar ── */}
        <nav style={{
          width: '220px', flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          padding: '1.5rem 0.5rem',
          display: 'flex', flexDirection: 'column', gap: '0.35rem',
        }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.75rem 1rem',
                background: activeTab === tab.id ? 'rgba(197, 160, 58, 0.08)' : 'transparent',
                border: 'none',
                borderLeft: activeTab === tab.id ? '3px solid var(--color-accent)' : '3px solid transparent',
                borderRadius: 'var(--radius-sm)',
                color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-muted)',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.85rem',
                fontWeight: activeTab === tab.id ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', opacity: activeTab === tab.id ? 1 : 0.7 }}>
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ── Main Content ── */}
        <main style={{ flex: 1, padding: '2rem 2.5rem', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          
          {/* Dashboard KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Candidates</span>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-strong)' }}>{candidates.length}</span>
            </div>
            
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Active Sessions</span>
                {activeCount > 0 && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', boxShadow: '0 0 8px var(--color-success)', animation: 'scan-pulse 2s infinite' }} />
                )}
              </div>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-strong)' }}>{activeCount}</span>
            </div>

            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Completion Rate</span>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-strong)' }}>{completionRate}% <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)', fontWeight: 400 }}>({submittedCount} submitted)</span></span>
            </div>

            <div style={{
              background: 'var(--color-surface)',
              border: criticalCount > 0 ? '1px solid rgba(209,69,56,0.3)' : '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              boxShadow: criticalCount > 0 ? '0 0 15px rgba(209,69,56,0.05)' : '0 2px 10px rgba(0,0,0,0.1)',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: criticalCount > 0 ? 'var(--color-danger)' : 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Proctoring Alerts</span>
                {criticalCount > 0 && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-danger)', display: 'inline-block', boxShadow: '0 0 8px var(--color-danger)' }} />
                )}
              </div>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, color: criticalCount > 0 ? 'var(--color-danger)' : 'var(--color-text-strong)' }}>{criticalCount}</span>
            </div>
          </div>

          {error && (
            <div style={{
              padding: '0.85rem 1.25rem',
              background: 'rgba(209,69,56,0.08)',
              border: '1px solid rgba(209,69,56,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--color-danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(209,69,56,0.05)'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </span>
              <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', padding: 0 }}>×</button>
            </div>
          )}

          {/* ── Candidates Tab ── */}
          {activeTab === 'candidates' && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.75rem', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-strong)', letterSpacing: '0.01em' }}>
                    Active Sitting Candidates
                  </h2>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    Monitor active attempts, access status codes, and proctoring risk indicators.
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  onClick={fetchCandidates}
                  style={{ fontSize: '0.75rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  disabled={loading}
                >
                  {loading && <span className="spinner" style={{ width: 10, height: 10 }} />}
                  ↻ Refresh Data
                </button>
              </div>

              {loading && candidates.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--color-muted)', fontSize: '0.85rem', padding: '3rem 0' }}>
                  <span className="spinner" style={{ width: 18, height: 18 }} /> Fetching candidate list...
                </div>
              ) : candidates.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '4rem 2rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-muted)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                  <p style={{ fontSize: '0.82rem', margin: 0 }}>No candidates registered in this exam sitting yet.</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-faint)', margin: 0 }}>Import students from CSV/XLSX using the admin CLI.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Candidate', 'Access Code', 'Exam Slot', 'Question Set ID', 'Exam Status', 'Risk Alert'].map((h) => (
                          <th key={h} style={{ padding: '0.85rem 1rem', color: 'var(--color-muted)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {h}
                          </th>
                        ))}
                        <th style={{ padding: '0.85rem 1rem' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => {
                        const avatarBg = getAvatarBg(c.name)
                        const rBadge = riskBadgeStyles(c.riskLevel)
                        return (
                          <tr
                            key={c.id}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                              transition: 'background var(--transition)',
                              cursor: 'default',
                            }}
                            className="table-row-hover"
                          >
                            {/* Candidate Name & Initials */}
                            <td style={{ padding: '0.9rem 1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                  width: '32px', height: '32px', borderRadius: '50%',
                                  background: avatarBg, color: 'var(--color-text-strong)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.02em',
                                  border: '1px solid var(--color-border)'
                                }}>
                                  {getInitials(c.name)}
                                </div>
                                <span style={{ fontWeight: 500, color: 'var(--color-text-strong)' }}>{c.name}</span>
                              </div>
                            </td>

                            {/* Access Code */}
                            <td style={{ padding: '0.9rem 1rem' }}>
                              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--color-accent)', background: 'rgba(197,160,58,0.05)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(197,160,58,0.15)' }}>
                                {c.access_code}
                              </code>
                            </td>

                            {/* Slot */}
                            <td style={{ padding: '0.9rem 1rem', color: 'var(--color-muted)' }}>{c.slot_id || '—'}</td>

                            {/* Question Set ID */}
                            <td style={{ padding: '0.9rem 1rem' }}>
                              {c.question_set_id ? (
                                <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--color-faint)' }}>
                                  {c.question_set_id}
                                </code>
                              ) : (
                                <span style={{ color: 'var(--color-disabled)' }}>Not assigned</span>
                              )}
                            </td>

                            {/* Exam Status */}
                            <td style={{ padding: '0.9rem 1rem' }}>
                              {c.attemptStatus === 'submitted' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-success)', background: 'rgba(118,199,192,0.08)', border: '1px solid rgba(118,199,192,0.2)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-success)' }} />
                                  Submitted
                                </span>
                              ) : c.attemptStatus === 'active' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-warning)', background: 'rgba(230,193,90,0.08)', border: '1px solid rgba(230,193,90,0.2)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                                  <span className="spinner" style={{ width: 6, height: 6, color: 'var(--color-warning)' }} />
                                  Active
                                </span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--color-muted)', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                                  Not Started
                                </span>
                              )}
                            </td>

                            {/* Risk Alert Indicator */}
                            <td style={{ padding: '0.9rem 1rem' }}>
                              {c.riskLevel ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                  fontSize: '0.68rem', fontWeight: 700,
                                  padding: '0.15rem 0.6rem', borderRadius: 'var(--radius-sm)',
                                  textTransform: 'uppercase', letterSpacing: '0.04em',
                                  ...rBadge
                                }}>
                                  {(c.riskLevel === 'CRITICAL' || c.riskLevel === 'HIGH') && (
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: rBadge.color, animation: 'scan-pulse 1.5s infinite' }} />
                                  )}
                                  {c.riskLevel}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-disabled)' }}>—</span>
                              )}
                            </td>

                            {/* Action Review Button */}
                            <td style={{ padding: '0.9rem 1rem', textAlign: 'right' }}>
                              {c.proctoringSessionId ? (
                                <button
                                  className="btn-ghost"
                                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                  onClick={() => navigate(`/teacher/session/${c.proctoringSessionId}`)}
                                >
                                  Review session
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                                  </svg>
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-disabled)' }}>—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Question Sets Tab ── */}
          {activeTab === 'question-sets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
                    Managed Question Sets ({questionSets.length})
                  </h2>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    Define configurations, publish sets, and view validation states.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button className="btn-ghost" onClick={fetchQuestionSets} disabled={loading} style={{ fontSize: '0.75rem', padding: '0.45rem 1rem' }}>
                    ↻ Refresh
                  </button>
                  <button className="btn-primary" onClick={() => setActiveTab('upload')} style={{ fontSize: '0.75rem', padding: '0.45rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>+</span> Create New Set
                  </button>
                </div>
              </div>

              {loading && questionSets.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--color-muted)', fontSize: '0.85rem', padding: '3rem 0' }}>
                  <span className="spinner" style={{ width: 18, height: 18 }} /> Fetching question sets...
                </div>
              ) : questionSets.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '4rem 2rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-muted)', textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p style={{ fontSize: '0.82rem', margin: 0 }}>No question sets uploaded yet.</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-faint)', margin: 0 }}>Click the "Create New Set" button or go to "Upload Questions" to build one.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
                  {questionSets.map((qs) => (
                    <div
                      key={qs.id}
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        padding: '1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '1.25rem',
                        boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                        transition: 'transform 0.2s ease, border-color 0.2s ease',
                      }}
                      className="card-hover"
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-strong)', lineHeight: 1.4 }}>
                            {qs.name}
                          </h3>
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 600,
                            padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)',
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                            color: qs.status === 'published' ? 'var(--color-success)' : qs.status === 'archived' ? 'var(--color-faint)' : 'var(--color-warning)',
                            background: qs.status === 'published' ? 'rgba(118,199,192,0.08)' : qs.status === 'archived' ? 'rgba(255,255,255,0.02)' : 'rgba(230,193,90,0.08)',
                            border: qs.status === 'published' ? '1px solid rgba(118,199,192,0.2)' : qs.status === 'archived' ? '1px solid var(--color-border)' : '1px solid rgba(230,193,90,0.2)',
                          }}>
                            {qs.status}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.25rem' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                            📚 <strong>{qs.question_count}</strong> question{qs.question_count !== 1 ? 's' : ''}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                            v{qs.version}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.85rem' }}>
                        <code style={{ fontSize: '0.68rem', color: 'var(--color-faint)', fontFamily: 'var(--font-mono)' }}>
                          ID: {qs.id.slice(0, 8)}…
                        </code>
                        
                        {qs.status === 'draft' ? (
                          <button
                            className="btn-primary"
                            onClick={() => handlePublish(qs.id)}
                            disabled={publishingId === qs.id}
                            style={{ fontSize: '0.72rem', padding: '0.35rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            {publishingId === qs.id && <span className="spinner" style={{ width: 10, height: 10, color: 'var(--color-bg-deep)' }} />}
                            Publish Set
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 500 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Active sitting
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Upload Tab ── */}
          {activeTab === 'upload' && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '1.75rem', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-strong)' }}>
                  Question Set Creator & Uploader
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  Enter a set identifier and upload questions in JSON format using pre-defined evaluation structures.
                </p>
              </div>
              <QuestionUpload
                token={teacherToken}
                onSuccess={(_id, _name) => {
                  setActiveTab('question-sets')
                  fetchQuestionSets()
                }}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
