/**
 * api.ts — thin fetch wrapper for backend calls.
 * TODO: attach JWT from AuthContext to every request
 * TODO: handle 401 → redirect to login
 */

const BASE_URL = '/api'

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      // TODO: 'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
    ...options,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }

  return res.json() as Promise<T>
}

export const api = {
  /** POST /attempts/start — begin a new attempt with an access code */
  startAttempt: (code: string) =>
    request<{ attemptId: string; token: string }>('/attempts/start', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /** GET /attempts/:id/state — server-authoritative exam state */
  getAttemptState: (attemptId: string) =>
    request<{ remainingSeconds: number; submitted: boolean; questions: unknown[] }>(
      `/attempts/${attemptId}/state`,
    ),

  /** POST /attempts/:id/answers — save one or more answers */
  saveAnswers: (attemptId: string, answers: Record<string, string>) =>
    request<{ saved: true }>(`/attempts/${attemptId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  /** POST /attempts/:id/submit — final submission */
  submitAttempt: (attemptId: string) =>
    request<{ submitted: true }>(`/attempts/${attemptId}/submit`, {
      method: 'POST',
    }),
}
