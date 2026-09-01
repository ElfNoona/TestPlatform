'use strict'

/**
 * AWS S3 Smoke Test — proctoring media lifecycle
 *
 * Tests the complete object lifecycle against a real AWS S3 bucket:
 *   1. Generate presigned PUT URL
 *   2. Upload a test JPEG via HTTP PUT (simulated via buffer)
 *   3. HEAD check — verify object exists
 *   4. Generate presigned GET URL
 *   5. DELETE object
 *
 * Usage:
 *   Ensure .env is populated with MEDIA_STORAGE_PROVIDER=s3 and all AWS_* vars.
 *   Then run from the proctoring/ directory:
 *     node scratch/smoke_test_s3.js
 *
 * Safety: Uses a unique timestamped key and ALWAYS deletes the test object
 * (even on failure) to prevent orphaned files in the bucket.
 */

require('dotenv').config()

const https = require('https')
const http = require('http')
const { URL } = require('url')

// Force s3 provider for the smoke test regardless of .env setting
process.env.MEDIA_STORAGE_PROVIDER = 's3'

let S3StorageAdapter
try {
  S3StorageAdapter = require('../src/storage/s3.storage')
} catch (err) {
  console.error('[smoke-test] ❌ Failed to load S3StorageAdapter:', err.message)
  process.exit(1)
}

// ── Tiny helper: HTTP PUT a buffer to a presigned URL ────────────────────────
function putBuffer(presignedUrl, buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(presignedUrl)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const options = {
      method: 'PUT',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': buffer.length
      }
    }

    const req = lib.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode)
        } else {
          reject(new Error(`PUT failed: HTTP ${res.statusCode} — ${body.slice(0, 200)}`))
        }
      })
    })

    req.on('error', reject)
    req.write(buffer)
    req.end()
  })
}

// ── Minimal synthetic JPEG buffer (2×2 pixel white JPEG, ~600 bytes) ─────────
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIhAAAQQC' +
  'AgMAAAAAAAAAAAAAAQIDBBEhMUFRYf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAA' +
  'AAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Aufo9LiN6WxbSEhCUj2A4A/ckkkn/2Q==',
  'base64'
)

async function runSmokeTest() {
  const testKey = `smoke-test/${Date.now()}-s3-adapter-test.jpg`
  const mimeType = 'image/jpeg'
  const UPLOAD_EXPIRY = 60 // 60 seconds for smoke test

  console.log('\n══════════════════════════════════════════════')
  console.log('  AWS S3 Storage Adapter — Smoke Test')
  console.log('══════════════════════════════════════════════')
  console.log(`  Bucket : ${process.env.AWS_S3_BUCKET_NAME}`)
  console.log(`  Region : ${process.env.AWS_REGION}`)
  console.log(`  Key    : ${testKey}`)
  console.log('══════════════════════════════════════════════\n')

  let adapter
  try {
    adapter = new S3StorageAdapter()
    console.log('[smoke-test] ✅ S3StorageAdapter instantiated (credentials valid)\n')
  } catch (err) {
    console.error('[smoke-test] ❌ S3StorageAdapter instantiation failed:', err.message)
    process.exit(1)
  }

  let allPassed = true

  try {
    // ── Step 1: Generate presigned PUT URL ──────────────────────────────────
    console.log('[1/5] Generating presigned PUT upload URL...')
    const t1 = Date.now()
    const uploadUrl = await adapter.getUploadUrl(testKey, mimeType, UPLOAD_EXPIRY)
    const d1 = Date.now() - t1
    if (!uploadUrl.includes('amazonaws.com') && !uploadUrl.includes('s3.')) {
      throw new Error(`Unexpected upload URL format: ${uploadUrl.slice(0, 80)}`)
    }
    console.log(`  ✅ Upload URL generated (${d1}ms)`)
    console.log(`     ${uploadUrl.slice(0, 80)}...\n`)

    // ── Step 2: PUT upload the synthetic JPEG ───────────────────────────────
    console.log('[2/5] Uploading test JPEG buffer via HTTP PUT...')
    const t2 = Date.now()
    const statusCode = await putBuffer(uploadUrl, MINIMAL_JPEG, mimeType)
    const d2 = Date.now() - t2
    console.log(`  ✅ PUT upload successful — HTTP ${statusCode} (${d2}ms)\n`)

    // ── Step 3: HEAD check — object must exist ──────────────────────────────
    console.log('[3/5] Verifying object exists via HEAD check...')
    const t3 = Date.now()
    const exists = await adapter.objectExists(testKey)
    const d3 = Date.now() - t3
    if (!exists) {
      throw new Error('objectExists() returned false immediately after upload — HEAD check failed')
    }
    console.log(`  ✅ Object exists confirmed (${d3}ms)\n`)

    // ── Step 4: Generate presigned GET URL ──────────────────────────────────
    console.log('[4/5] Generating presigned GET download URL...')
    const t4 = Date.now()
    const downloadUrl = await adapter.getDownloadUrl(testKey, UPLOAD_EXPIRY)
    const d4 = Date.now() - t4
    if (!downloadUrl.includes('amazonaws.com') && !downloadUrl.includes('s3.')) {
      throw new Error(`Unexpected download URL format: ${downloadUrl.slice(0, 80)}`)
    }
    console.log(`  ✅ Download URL generated (${d4}ms)`)
    console.log(`     ${downloadUrl.slice(0, 80)}...\n`)

    console.log('══════════════════════════════════════════════')
    console.log('  ALL CHECKS PASSED ✅')
    console.log('══════════════════════════════════════════════\n')

  } catch (err) {
    allPassed = false
    console.error('\n[smoke-test] ❌ SMOKE TEST FAILED:', err.message)
  } finally {
    // ── Step 5: Always delete the test object ───────────────────────────────
    console.log('[5/5] Cleaning up — deleting test object...')
    try {
      await adapter.deleteObject(testKey)
      console.log(`  ✅ Test object deleted: ${testKey}\n`)
    } catch (deleteErr) {
      console.warn(`  ⚠️  Failed to delete test object (orphan may exist): ${deleteErr.message}`)
      console.warn(`     Manual cleanup: aws s3 rm s3://${process.env.AWS_S3_BUCKET_NAME}/${testKey}\n`)
    }
  }

  process.exit(allPassed ? 0 : 1)
}

runSmokeTest()
