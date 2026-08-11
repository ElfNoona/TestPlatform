'use strict'

/**
 * OciAdapter — Oracle Cloud Infrastructure Object Storage adapter.
 *
 * ⚠️  NOT YET IMPLEMENTED — see docs/decisions.md #4
 *
 * This file is a placeholder that implements the StorageAdapter interface
 * so it can be swapped in by changing one line in src/index.js.
 *
 * When ready to implement:
 *   1. npm install oci-sdk (or aws-sdk with S3-compatible OCI endpoint)
 *   2. Fill in OCI_NAMESPACE, OCI_BUCKET, OCI_ACCESS_KEY, OCI_SECRET_KEY in .env
 *   3. Implement save() and status() below
 *   4. In src/index.js: replace LocalAdapter with OciAdapter
 *
 * OCI Object Storage S3-compatible endpoint format:
 *   https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
 */
class OciAdapter {
  constructor() {
    // TODO: initialise OCI SDK client
    // this.client = new OciObjectStorageClient({ ... })
    this.bucket    = process.env.OCI_BUCKET
    this.namespace = process.env.OCI_NAMESPACE
  }

  async save(_attemptId, _buffer, _mimeType) {
    throw new Error('OciAdapter.save() is not yet implemented — see decisions.md #4')
  }

  async status(_attemptId) {
    throw new Error('OciAdapter.status() is not yet implemented — see decisions.md #4')
  }
}

module.exports = OciAdapter
