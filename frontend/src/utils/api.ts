/**
 * api.ts — typed fetch wrapper for backend calls.
 * Attaches JWT from the provided token to every request.
 * On 401, calls onUnauthorized (wired to logout + navigate in App).
 */

const BASE_URL = '/api'

// ── Question type (shared with QuestionRenderer) ─────────────────────────────
export interface Question {
  id: string
  type: 'mcq' | 'output-prediction' | 'debug' | 'coding'
  prompt: string
  starterCode?: string
  options?: string[]  // MCQ choices
  order?: number
}

export interface AttemptState {
  remainingSeconds: number
  submitted: boolean
  questions: Question[]
  currentQuestionIndex?: number
}

// ── Internal fetch wrapper ────────────────────────────────────────────────────
let _onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: () => void) {
  _onUnauthorized = fn
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (res.status === 401) {
    _onUnauthorized?.()
    throw new Error('Session expired. Please log in again.')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ── Public API ────────────────────────────────────────────────────────────────
export const api = {
  /**
   * POST /attempts/start — begin a new attempt with an access code.
   * Does NOT require a token.
   */
  startAttempt: (code: string) =>
    request<{
      attemptId: string
      token: string
      proctoring: { sessionId: string | null; status: string }
    }>('/attempts/start', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /**
   * GET /attempts/:id/state — server-authoritative exam state.
   * Requires student JWT.
   */
  getAttemptState: (attemptId: string, token: string) =>
    request<AttemptState>(`/attempts/${attemptId}/state`, {}, token),

  /**
   * POST /attempts/:id/answers — upsert answers (autosave every 30s).
   * Requires student JWT.
   */
  saveAnswers: (attemptId: string, answers: Record<string, string>, token: string) =>
    request<{ saved: true }>(`/attempts/${attemptId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }, token),

  /**
   * POST /attempts/:id/submit — final submission.
   * Requires student JWT.
   */
  submitAttempt: (attemptId: string, token: string) =>
    request<{ submitted: true; proctoring?: unknown }>(`/attempts/${attemptId}/submit`, {
      method: 'POST',
    }, token),

  // ── Teacher Admin API ─────────────────────────────────────────────────────

  /** GET /admin/students — list all students */
  getStudents: (token: string) =>
    request<{ students: any[] }>('/admin/students', {}, token),

  /** POST /admin/students — upsert student */
  upsertStudent: (data: { name: string; accessCode: string; slotId?: string; questionSetId?: string }, token: string) =>
    request<{ student: any }>('/admin/students', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  /** GET /admin/question-sets — list all question sets */
  getQuestionSets: (token: string) =>
    request<{ questionSets: any[] }>('/admin/question-sets', {}, token),

  /** POST /admin/question-sets — create new question set */
  createQuestionSet: (name: string, token: string) =>
    request<{ questionSet: any }>('/admin/question-sets', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }, token),

  /** POST /admin/question-sets/:id/publish — publish a draft set */
  publishQuestionSet: (setId: string, token: string) =>
    request<{ questionSet: any }>(`/admin/question-sets/${setId}/publish`, {
      method: 'POST',
    }, token),

  /** POST /admin/question-sets/:id/questions — bulk upload questions */
  uploadQuestions: (setId: string, questions: any[], token: string) =>
    request<{ questions: any[]; message: string }>(`/admin/question-sets/${setId}/questions`, {
      method: 'POST',
      body: JSON.stringify({ questions }),
    }, token),

  /** POST /auth/teacher/login — login with teacher access code */
  teacherLogin: (code: string) =>
    request<{ token: string; role: string }>('/auth/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /** GET /admin/sessions/:sessionId — get session details, events, media, and reviews */
  getSessionDetails: (sessionId: string, token: string) =>
    request<{ session: any; student: any; events: any[]; media: any[]; reviews: any[] }>(`/admin/sessions/${sessionId}`, {}, token),

  /** POST /admin/sessions/:sessionId/review — submit teacher integrity verdict */
  submitSessionReview: (sessionId: string, data: { decision: 'VALID' | 'SUSPICIOUS' | 'VIOLATION'; comment?: string }, token: string) =>
    request<{ review: any }>(`/admin/sessions/${sessionId}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),
}
