'use strict'

/**
 * compiler-service/worker/src/index.js
 *
 * BullMQ worker that processes code-execution jobs.
 * For each job it:
 *   1. Writes the submitted code to a temp file
 *   2. Uses Dockerode to run it inside the sandbox container
 *   3. Captures stdout/stderr and exit code
 *   4. Cleans up the container
 *   5. Returns { stdout, stderr, exitCode, timedOut }
 *
 * Resource limits are applied at container creation time:
 *   - Memory: 256 MB
 *   - CPU: 0.5 cores
 *   - PIDs: 64  (prevents fork bombs)
 *   - Network: none
 *   - Read-only root FS (except /tmp)
 *
 * TODO: tune EXEC_CONCURRENCY — run rehearsal with full 20-student batch (decisions.md #5)
 * TODO: add job retry policy if container fails to start (Docker socket issue)
 * TODO: consider gVisor / Kata Containers for stronger kernel isolation
 */

require('dotenv').config()
const { Worker } = require('bullmq')
const Docker = require('dockerode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const EXEC_CONCURRENCY = parseInt(process.env.EXEC_CONCURRENCY || '4', 10)
const SANDBOX_IMAGE = process.env.DOCKER_SANDBOX_IMAGE || 'exam-platform/dart-sandbox:latest'

const redisUrl = new URL(REDIS_URL)
const redisConnection = { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }

const docker = new Docker()  // connects via /var/run/docker.sock by default

const worker = new Worker(
  'exec',
  async (job) => {
    const { code, stdin = '', timeoutMs = 10_000 } = job.data

    // 1. Write code to a temp file on the host, then bind-mount into container
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-exec-'))
    const srcFile = path.join(tmpDir, 'solution.dart')
    fs.writeFileSync(srcFile, code, 'utf8')

    let container = null
    let timedOut  = false

    try {
      // 2. Create the sandbox container
      // TODO: verify resource limit syntax against your Docker / Dockerode version
      container = await docker.createContainer({
        Image:     SANDBOX_IMAGE,
        Cmd:       ['dart', 'run', '/workspace/solution.dart'],
        HostConfig: {
          Binds:       [`${tmpDir}:/workspace:ro`],
          Memory:      256 * 1024 * 1024,  // 256 MB
          NanoCpus:    500_000_000,         // 0.5 CPU
          PidsLimit:   64,
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'size=32m' },
        },
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: !!stdin,
      })

      // 3. Start and collect output
      const stream = await container.attach({ stream: true, stdout: true, stderr: true })
      let stdout = '', stderr = ''

      await container.start()

      const outputPromise = new Promise((resolve) => {
        docker.modem.demuxStream(stream, {
          write: (chunk) => { stdout += chunk.toString() },
        }, {
          write: (chunk) => { stderr += chunk.toString() },
        })
        stream.on('end', resolve)
      })

      // 4. Enforce timeout
      const timeoutHandle = setTimeout(async () => {
        timedOut = true
        try { await container.kill() } catch { /* already dead */ }
      }, timeoutMs)

      await outputPromise
      clearTimeout(timeoutHandle)

      const inspectData = await container.inspect()
      const exitCode = inspectData.State.ExitCode

      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, timedOut }
    } finally {
      // 5. Always clean up — never leave zombie containers
      if (container) {
        try { await container.remove({ force: true }) } catch { /* ignore */ }
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  },
  {
    connection: redisConnection,
    concurrency: EXEC_CONCURRENCY,
  }
)

worker.on('completed', (job, result) => {
  console.log(`[worker] job ${job.id} completed — exitCode: ${result.exitCode}`)
})
worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message)
})

console.log(`[compiler-worker] started — concurrency: ${EXEC_CONCURRENCY}`)
