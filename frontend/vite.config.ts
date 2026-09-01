import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

// ── Dev-only mock data ────────────────────────────────────────────────────────
const DEV_CODE        = 'TEST-2026'
const DEV_TOKEN       = 'dev-jwt-token-not-real'
const DEV_ATTEMPT_ID  = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const DEV_QUESTIONS = [
  {
    id: 'q1-mcq',
    type: 'mcq',
    order: 0,
    prompt: 'Which of the following is the correct way to declare a nullable String variable in Dart?',
    options: ['String name;', 'String? name;', 'nullable String name;', 'String name = null;'],
  },
  {
    id: 'q2-coding',
    type: 'coding',
    order: 1,
    prompt: 'Write a Dart function `int sumList(List<int> nums)` that returns the sum of all integers in the list. Handle an empty list by returning 0.',
    starterCode: 'int sumList(List<int> nums) {\n  // TODO: implement\n}\n\nvoid main() {\n  print(sumList([1, 2, 3, 4, 5])); // expected: 15\n  print(sumList([]));              // expected: 0\n}\n',
  },
  {
    id: 'q3-output',
    type: 'output-prediction',
    order: 2,
    prompt: 'What does the following Dart program print?',
    starterCode: 'void main() {\n  var items = [1, 2, 3, 4, 5];\n  var result = items\n    .where((x) => x.isOdd)\n    .map((x) => x * x)\n    .toList();\n  print(result);\n}\n',
  },
]

// ── Mock API middleware plugin ────────────────────────────────────────────────
function devMockApiPlugin(): Plugin {
  // In-memory data store persisting across requests in dev mode
  const mockStudents = [
    { id: '1', name: 'Aarav Mehta', access_code: 'AARV-8392', slot_id: 'Morning (09:00 - 11:00)', question_set_id: 'qset-1', attemptStatus: 'active', riskLevel: 'LOW', proctoringSessionId: 'sess-1' },
    { id: '2', name: 'Neha Sharma', access_code: 'NEHA-4819', slot_id: 'Morning (09:00 - 11:00)', question_set_id: 'qset-1', attemptStatus: 'submitted', riskLevel: 'CRITICAL', proctoringSessionId: 'sess-2' },
    { id: '3', name: 'Kabir Singh', access_code: 'KABR-9021', slot_id: 'Afternoon (14:00 - 16:00)', question_set_id: 'qset-2', attemptStatus: 'submitted', riskLevel: 'MEDIUM', proctoringSessionId: 'sess-3' },
    { id: '4', name: 'Ishita Roy', access_code: 'ISHT-2839', slot_id: 'Afternoon (14:00 - 16:00)', question_set_id: 'qset-2', attemptStatus: 'active', riskLevel: 'HIGH', proctoringSessionId: 'sess-4' },
    { id: '5', name: 'Rahul Verma', access_code: 'RAHL-5510', slot_id: 'Morning (09:00 - 11:00)', question_set_id: 'qset-1', attemptStatus: null, riskLevel: null, proctoringSessionId: null }
  ];

  const mockQuestionSets = [
    { id: 'qset-1', name: 'Dart Basics & OOP', version: 1, status: 'published' as const, question_count: 3, created_at: new Date().toISOString(), published_at: new Date().toISOString() },
    { id: 'qset-2', name: 'Flutter Advanced UI', version: 1, status: 'draft' as const, question_count: 5, created_at: new Date().toISOString(), published_at: null }
  ];

  return {
    name: 'dev-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(
        '/api',
        (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
          const url    = req.url ?? ''
          const method = req.method ?? 'GET'

          function json(data: unknown, status = 200) {
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          }

          function parseBody(): Promise<Record<string, unknown>> {
            return new Promise<Record<string, unknown>>((resolve) => {
              let body = ''
              req.on('data', (chunk: Buffer) => { body += chunk.toString() })
              req.on('end', () => {
                try { resolve(JSON.parse(body) as Record<string, unknown>) } catch { resolve({}) }
              })
            })
          }

          // POST /api/attempts/start
          if (url === '/attempts/start' && method === 'POST') {
            parseBody().then((body) => {
              const code = (body.code as string ?? '').toUpperCase().trim()
              if (code !== DEV_CODE) {
                return json({ error: `Invalid code. Use "${DEV_CODE}" for dev.` }, 403)
              }
              json({
                attemptId: DEV_ATTEMPT_ID,
                token: DEV_TOKEN,
                proctoring: { sessionId: null, status: 'UNAVAILABLE' },
              }, 201)
            })
            return
          }

          // GET /api/attempts/:id/state
          const stateMatch = url.match(/^\/attempts\/([^/]+)\/state$/)
          if (stateMatch && method === 'GET') {
            return json({
              remainingSeconds: 7200,
              submitted: false,
              questions: DEV_QUESTIONS,
            })
          }

          // POST /api/attempts/:id/answers  (autosave)
          const answersMatch = url.match(/^\/attempts\/([^/]+)\/answers$/)
          if (answersMatch && method === 'POST') {
            return json({ saved: true })
          }

          // POST /api/attempts/:id/submit
          const submitMatch = url.match(/^\/attempts\/([^/]+)\/submit$/)
          if (submitMatch && method === 'POST') {
            return json({ submitted: true })
          }

          // POST /api/auth/teacher/login
          if (url === '/auth/teacher/login' && method === 'POST') {
            parseBody().then((body) => {
              const code = (body.code as string ?? '').toUpperCase().trim()
              if (code !== 'TEACHER-2026') {
                return json({ error: 'Invalid teacher access code. Use "TEACHER-2026" for dev.' }, 403)
              }
              json({
                token: 'mock-teacher-token',
                role: 'teacher',
              }, 200)
            })
            return
          }

          // GET /api/admin/students
          if (url === '/admin/students' && method === 'GET') {
            return json({ students: mockStudents })
          }

          // POST /api/admin/students
          if (url === '/admin/students' && method === 'POST') {
            parseBody().then((body) => {
              const { name, accessCode, slotId, questionSetId } = body as any
              const existingIndex = mockStudents.findIndex(s => s.access_code === accessCode)
              if (existingIndex !== -1) {
                mockStudents[existingIndex] = {
                  ...mockStudents[existingIndex],
                  name,
                  slot_id: slotId || null,
                  question_set_id: questionSetId || null
                }
                json({ student: mockStudents[existingIndex] })
              } else {
                const newStudent = {
                  id: String(mockStudents.length + 1),
                  name,
                  access_code: accessCode,
                  slot_id: slotId || null,
                  question_set_id: questionSetId || null,
                  attemptStatus: null,
                  riskLevel: null,
                  proctoringSessionId: null
                }
                mockStudents.push(newStudent)
                json({ student: newStudent }, 201)
              }
            })
            return
          }

          // GET /api/admin/question-sets
          if (url === '/admin/question-sets' && method === 'GET') {
            return json({ questionSets: mockQuestionSets })
          }

          // POST /api/admin/question-sets
          if (url === '/admin/question-sets' && method === 'POST') {
            parseBody().then((body) => {
              const { name } = body as any
              const newSet = {
                id: `qset-${mockQuestionSets.length + 1}`,
                name: name.trim(),
                version: 1,
                status: 'draft' as const,
                question_count: 0,
                created_at: new Date().toISOString(),
                published_at: null
              }
              mockQuestionSets.push(newSet)
              json({ questionSet: newSet }, 201)
            })
            return
          }

          // POST /api/admin/question-sets/:id/publish
          const publishMatch = url.match(/^\/admin\/question-sets\/([^/]+)\/publish$/)
          if (publishMatch && method === 'POST') {
            const id = publishMatch[1]
            const qset = mockQuestionSets.find(q => q.id === id)
            if (qset) {
              qset.status = 'published'
              qset.published_at = new Date().toISOString()
              return json({ questionSet: qset })
            }
            return json({ error: 'Question set not found' }, 404)
          }

          // POST /api/admin/question-sets/:id/questions
          const questionsMatch = url.match(/^\/admin\/question-sets\/([^/]+)\/questions$/)
          if (questionsMatch && method === 'POST') {
            const id = questionsMatch[1]
            parseBody().then((body) => {
              const { questions } = body as any
              const qset = mockQuestionSets.find(q => q.id === id)
              if (qset) {
                qset.question_count = questions.length
                return json({ questions, message: `${questions.length} question(s) uploaded successfully` })
              }
              json({ error: 'Question set not found' }, 404)
            })
            return
          }

          // GET /api/admin/sessions/:sessionId
          const sessionMatch = url.match(/^\/admin\/sessions\/([^/]+)$/)
          if (sessionMatch && method === 'GET') {
            const sessionId = sessionMatch[1]
            const student = mockStudents.find(s => s.proctoringSessionId === sessionId)
            if (!student) {
              return json({ error: 'Proctoring session not found' }, 404)
            }

            // Generate mock events based on student risk
            const events = [
              { id: 'ev-1', type: 'SESSION_STARTED', client_timestamp: new Date(Date.now() - 3600000).toISOString(), metadata: {} },
            ]

            if (student.riskLevel === 'CRITICAL' || student.riskLevel === 'HIGH') {
              events.push(
                { id: 'ev-2', type: 'TAB_HIDDEN', client_timestamp: new Date(Date.now() - 3000000).toISOString(), metadata: { url: 'https://google.com/search?q=dart+nullable+types' } },
                { id: 'ev-3', type: 'FOCUS_LOST', client_timestamp: new Date(Date.now() - 2500000).toISOString(), metadata: {} },
                { id: 'ev-4', type: 'FULLSCREEN_EXITED', client_timestamp: new Date(Date.now() - 2000000).toISOString(), metadata: {} },
                { id: 'ev-5', type: 'CAMERA_STOPPED', client_timestamp: new Date(Date.now() - 1500000).toISOString(), metadata: { reason: 'permission_denied' } }
              )
            } else if (student.riskLevel === 'MEDIUM') {
              events.push(
                { id: 'ev-2', type: 'FOCUS_LOST', client_timestamp: new Date(Date.now() - 2800000).toISOString(), metadata: {} },
                { id: 'ev-3', type: 'TAB_HIDDEN', client_timestamp: new Date(Date.now() - 1200000).toISOString(), metadata: { url: 'https://stackoverflow.com/' } }
              )
            }

            events.push({ id: 'ev-last', type: 'HEARTBEAT', client_timestamp: new Date(Date.now() - 60000).toISOString(), metadata: {} })

            // Generate mock media (webcam and desktop snapshots as SVG data URIs)
            const media = [
              {
                id: 'media-1',
                event_id: 'ev-1',
                media_type: 'webcam',
                status: 'COMPLETED',
                captured_at: new Date(Date.now() - 3600000).toISOString(),
                storage_key: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23262624"/><circle cx="150" cy="80" r="30" fill="%23C5A03A"/><path d="M100 150 C100 120, 200 120, 200 150" fill="%23C5A03A"/><text x="15" y="185" fill="%238E8E8A" font-family="sans-serif" font-size="10">Webcam: Verified candidate</text></svg>`
              },
              {
                id: 'media-2',
                event_id: 'ev-1',
                media_type: 'desktop',
                status: 'COMPLETED',
                captured_at: new Date(Date.now() - 3550000).toISOString(),
                storage_key: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23121211"/><rect x="20" y="20" width="260" height="140" fill="%23262624" stroke="%233B3B38"/><text x="30" y="50" fill="%23E2E2E0" font-family="monospace" font-size="10">void main() {</text><text x="30" y="70" fill="%23E2E2E0" font-family="monospace" font-size="10">  print('Hello KRS');</text><text x="30" y="90" fill="%23E2E2E0" font-family="monospace" font-size="10">}</text><text x="15" y="185" fill="%238E8E8A" font-family="sans-serif" font-size="10">Desktop: Exam Portal Active</text></svg>`
              }
            ]

            if (student.riskLevel === 'CRITICAL' || student.riskLevel === 'HIGH') {
              media.push(
                {
                  id: 'media-3',
                  event_id: 'ev-2',
                  media_type: 'desktop',
                  status: 'COMPLETED',
                  captured_at: new Date(Date.now() - 3000000).toISOString(),
                  storage_key: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23262624" stroke="%23D14538" stroke-width="4"/><text x="15" y="40" fill="%23D14538" font-family="sans-serif" font-weight="bold" font-size="12">ALERT: UNEXPECTED APPLICATION DETECTED</text><text x="15" y="80" fill="%23E2E2E0" font-family="sans-serif" font-size="10">Browser: Google Search active</text><text x="15" y="100" fill="%238E8E8A" font-family="sans-serif" font-size="10">Query: 'dart nullable types'</text></svg>`
                },
                {
                  id: 'media-4',
                  event_id: 'ev-5',
                  media_type: 'webcam',
                  status: 'COMPLETED',
                  captured_at: new Date(Date.now() - 1500000).toISOString(),
                  storage_key: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23262624" stroke="%23D14538" stroke-width="4"/><circle cx="150" cy="100" r="40" fill="none" stroke="%236E6E6A" stroke-dasharray="4"/><text x="60" y="160" fill="%23D14538" font-family="sans-serif" font-weight="bold" font-size="12">VIOLATION: NO FACE DETECTED</text></svg>`
                }
              )
            }

            return json({
              session: {
                id: sessionId,
                attempt_id: `att-${sessionId}`,
                student_id: student.id,
                risk_score: student.riskLevel === 'CRITICAL' ? 95 : student.riskLevel === 'HIGH' ? 75 : student.riskLevel === 'MEDIUM' ? 45 : 10,
                risk_level: student.riskLevel || 'LOW',
                status: student.attemptStatus === 'submitted' ? 'SUBMITTED' : 'ACTIVE',
                connection_status: student.attemptStatus === 'submitted' ? 'DISCONNECTED' : 'CONNECTED',
                started_at: new Date(Date.now() - 3600000).toISOString(),
                ended_at: student.attemptStatus === 'submitted' ? new Date().toISOString() : null,
              },
              student,
              events,
              media,
              reviews: []
            })
          }

          // POST /api/admin/sessions/:sessionId/review
          const reviewMatch = url.match(/^\/admin\/sessions\/([^/]+)\/review$/)
          if (reviewMatch && method === 'POST') {
            const sessionId = reviewMatch[1]
            parseBody().then((body) => {
              const { decision, comment } = body as any
              const student = mockStudents.find(s => s.proctoringSessionId === sessionId)
              if (student) {
                student.riskLevel = decision === 'VALID' ? 'LOW' : decision === 'SUSPICIOUS' ? 'MEDIUM' : 'CRITICAL'
                return json({
                  review: {
                    id: `rev-${Date.now()}`,
                    proctoring_session_id: sessionId,
                    teacher_id: 'teacher@krs.org',
                    decision,
                    comment,
                    reviewed_at: new Date().toISOString()
                  }
                })
              }
              json({ error: 'Proctoring session not found' }, 404)
            })
            return
          }

          // Fallback — not mocked
          next()
        }
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devMockApiPlugin()],
  server: {
    port: 5173,
    proxy: {
      // When the real backend is running, admin/* and other unhandled API
      // calls fall through the mock middleware (via next()) and are proxied here.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

