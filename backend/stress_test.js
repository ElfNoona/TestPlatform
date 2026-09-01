const { Pool } = require('pg')
const crypto = require('crypto')
const fs = require('fs')

const DB_URL = 'postgresql://examuser:changeme@localhost:5433/examplatform'
const BACKEND_URL = 'http://localhost:4000'
const CONCURRENCY = 50
const TOTAL_USERS = 300
const WAVE_DELAY_MS = 300

const pool = new Pool({ connectionString: DB_URL, max: 20 })

const stats = {
  startOk: 0, startFail: 0,
  stateOk: 0, stateFail: 0,
  saveOk: 0, saveFail: 0,
  submitOk: 0, submitFail: 0,
  latencies: [],
  errors: []
}

async function seedCandidate(i) {
  const studentId = crypto.randomUUID()
  const code = `st-${i}-${crypto.randomUUID().slice(0, 6)}`
  const qSetId = '11111111-1111-1111-1111-111111111111'
  await pool.query(
    `INSERT INTO students (id, name, access_code, question_set_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [studentId, `StressUser-${i}`, code, qSetId]
  )
  return { studentId, code }
}

async function runCandidate(code, index) {
  const t0 = Date.now()
  try {
    const startRes = await fetch(`${BACKEND_URL}/attempts/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    if (!startRes.ok) {
      const txt = await startRes.text().catch(() => '')
      stats.startFail++
      stats.errors.push(`user${index} start ${startRes.status}: ${txt.slice(0,80)}`)
      return
    }
    stats.startOk++
    const { attemptId, token } = await startRes.json()

    const stateRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/state`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!stateRes.ok) { stats.stateFail++; return }
    stats.stateOk++
    const stateData = await stateRes.json()
    const qId = stateData.questions?.[0]?.id || crypto.randomUUID()

    for (let s = 0; s < 3; s++) {
      const saveRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ answers: { [qId]: `Answer-${s}-user${index}` } })
      })
      if (saveRes.ok) stats.saveOk++; else stats.saveFail++
    }

    const subRes = await fetch(`${BACKEND_URL}/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (subRes.ok) stats.submitOk++; else stats.submitFail++

    stats.latencies.push(Date.now() - t0)
  } catch (err) {
    stats.startFail++
    stats.errors.push(`user${index} exception: ${err.message?.slice(0,80)}`)
    stats.latencies.push(Date.now() - t0)
  }
}

async function main() {
  // Warm up: verify backend is reachable
  for (let retry = 0; retry < 10; retry++) {
    try {
      const r = await fetch(`${BACKEND_URL}/health`)
      if (r.ok) break
    } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 1000))
  }

  const qSetId = '11111111-1111-1111-1111-111111111111'
  const qId = '22222222-2222-2222-2222-222222222222'
  await pool.query(`INSERT INTO question_sets (id, name, status) VALUES ($1, 'Stress Test Set', 'published') ON CONFLICT DO NOTHING`, [qSetId])
  await pool.query(`INSERT INTO questions (id, question_set_id, type, prompt, correct_answer, marks, order_index) VALUES ($1, $2, 'mcq', 'Stress Q1', 'A', 5, 1) ON CONFLICT DO NOTHING`, [qId, qSetId])

  const candidates = []
  for (let i = 0; i < TOTAL_USERS; i++) {
    candidates.push(await seedCandidate(i))
  }

  const totalWaves = Math.ceil(TOTAL_USERS / CONCURRENCY)
  const globalStart = Date.now()

  for (let w = 0; w < totalWaves; w++) {
    const start = w * CONCURRENCY
    const end = Math.min(start + CONCURRENCY, TOTAL_USERS)
    const wave = candidates.slice(start, end)
    await Promise.all(wave.map((c, i) => runCandidate(c.code, start + i)))
    if (w < totalWaves - 1) await new Promise(r => setTimeout(r, WAVE_DELAY_MS))
  }

  const totalTime = Date.now() - globalStart
  const sorted = stats.latencies.sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0
  const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0
  const failTotal = stats.startFail + stats.stateFail + stats.saveFail + stats.submitFail
  const okTotal = stats.startOk + stats.stateOk + stats.saveOk + stats.submitOk

  const report = {
    config: { totalUsers: TOTAL_USERS, concurrency: CONCURRENCY, waves: totalWaves },
    timing: { wallTimeMs: totalTime, throughputUsersPerSec: +(TOTAL_USERS / (totalTime / 1000)).toFixed(1) },
    results: {
      start: { ok: stats.startOk, fail: stats.startFail },
      state: { ok: stats.stateOk, fail: stats.stateFail },
      save: { ok: stats.saveOk, fail: stats.saveFail },
      submit: { ok: stats.submitOk, fail: stats.submitFail }
    },
    latencyMs: { avg, p50, p95, p99, min: sorted[0] || 0, max: sorted[sorted.length - 1] || 0 },
    summary: { totalOps: okTotal + failTotal, failures: failTotal, errorRate: +((failTotal / (okTotal + failTotal)) * 100).toFixed(2) },
    sampleErrors: stats.errors.slice(0, 10)
  }

  fs.writeFileSync('stress_report.json', JSON.stringify(report, null, 2))

  // Cleanup
  await pool.query(`DELETE FROM grades WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'StressUser-%'))`)
  await pool.query(`DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'StressUser-%'))`)
  await pool.query(`DELETE FROM attempts WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'StressUser-%')`)
  await pool.query(`DELETE FROM students WHERE name LIKE 'StressUser-%'`)
  await pool.end()
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
