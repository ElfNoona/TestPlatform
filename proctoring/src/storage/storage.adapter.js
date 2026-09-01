'use strict'

/**
 * StorageAdapter — Interface/Base class for proctoring media storage.
 */
class StorageAdapter {
  /**
   * Generates a short-lived presigned URL for uploading (PUT request) an object.
   * @param {string} key - Object key in the storage bucket
   * @param {string} mimeType - The MIME type of the file (e.g. image/jpeg)
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {Promise<string>} Presigned upload URL
   */
  async getUploadUrl(key, mimeType, expiresIn) {
    throw new Error('StorageAdapter.getUploadUrl() not implemented')
  }

  /**
   * Generates a short-lived presigned URL for downloading (GET request) an object.
   * @param {string} key - Object key in the storage bucket
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {Promise<string>} Presigned download URL
   */
  async getDownloadUrl(key, expiresIn) {
    throw new Error('StorageAdapter.getDownloadUrl() not implemented')
  }

  /**
   * Deletes an object from the storage.
   * @param {string} key - Object key in the storage bucket
   * @returns {Promise<void>}
   */
  async deleteObject(key) {
    throw new Error('StorageAdapter.deleteObject() not implemented')
  }

  /**
   * Checks if an object exists in storage.
   * @param {string} key - Object key in the storage bucket
   * @returns {Promise<boolean>}
   */
  async objectExists(key) {
    throw new Error('StorageAdapter.objectExists() not implemented')
  }
}

module.exports = StorageAdapter
