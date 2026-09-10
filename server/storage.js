/**
 * Cortex Storage Abstraction Layer
 *
 * Supports local filesystem storage and S3-compatible object storage (MinIO, AWS S3, Backblaze B2, Cloudflare R2).
 *
 * Usage:
 *   import { storage } from './storage.js';
 *
 *   // Upload a file
 *   const url = await storage.upload(buffer, 'media/video.mp4', 'video/mp4');
 *
 *   // Delete a file
 *   await storage.delete('media/video.mp4');
 *
 *   // Get presigned upload URL (for direct browser uploads)
 *   const { uploadUrl, publicUrl } = await storage.getPresignedUploadUrl('media/video.mp4', 'video/mp4');
 */

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

class StorageProvider {
  constructor() {
    this.provider = process.env.STORAGE_PROVIDER || 'local';
    this.initialized = false;
  }

  /**
   * Initialize the storage provider.
   * Call this after environment variables are loaded.
   */
  init() {
    if (this.initialized) return;

    this.provider = process.env.STORAGE_PROVIDER || 'local';

    if (this.provider === 's3') {
      // S3-compatible storage (MinIO, AWS S3, Backblaze B2, Cloudflare R2)
      const endpoint = process.env.S3_ENDPOINT;
      const accessKey = process.env.S3_ACCESS_KEY;
      const secretKey = process.env.S3_SECRET_KEY;
      const bucket = process.env.S3_BUCKET;

      if (!endpoint || !accessKey || !secretKey || !bucket) {
        console.warn('⚠️  S3 storage configured but missing credentials. Falling back to local storage.');
        console.warn('    Required: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET');
        this.provider = 'local';
      } else {
        this.s3 = new S3Client({
          endpoint: endpoint,
          region: process.env.S3_REGION || 'us-east-1',
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
          },
          forcePathStyle: true, // Required for MinIO
        });
        this.bucket = bucket;
        this.publicUrl = process.env.S3_PUBLIC_URL || endpoint;

        console.log(`📦 Storage: S3-compatible (${endpoint})`);
      }
    }

    if (this.provider === 'local') {
      this.uploadsDir = path.join(process.cwd(), 'uploads');
      this.mediaDir = path.join(this.uploadsDir, 'media'); // Match server's MEDIA_DIR

      // Ensure directories exist
      [this.uploadsDir, this.mediaDir,
       path.join(this.uploadsDir, 'avatars'),
       path.join(this.uploadsDir, 'messages'),
       path.join(this.uploadsDir, 'files')].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });

      console.log('📦 Storage: Local filesystem');
    }

    this.initialized = true;
  }

  /**
   * Upload a file to storage.
   * @param {Buffer} buffer - File contents
   * @param {string} key - Storage key/path (e.g., 'avatars/user123.jpg', 'media/video.mp4')
   * @param {string} contentType - MIME type
   * @returns {Promise<string>} Public URL of the uploaded file
   */
  async upload(buffer, key, contentType) {
    this.init();

    if (this.provider === 's3') {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        // Make publicly readable
        ACL: 'public-read',
      }));

      // Return public URL
      return `${this.publicUrl}/${this.bucket}/${key}`;
    } else {
      // Local storage
      const filepath = this.getLocalPath(key);
      const dir = path.dirname(filepath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filepath, buffer);

      // Return URL path (relative to server)
      return this.getLocalUrl(key);
    }
  }

  /**
   * Delete a file from storage.
   * @param {string} key - Storage key/path
   */
  async delete(key) {
    this.init();

    if (this.provider === 's3') {
      try {
        await this.s3.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }));
      } catch (err) {
        console.warn(`Failed to delete S3 object ${key}:`, err.message);
      }
    } else {
      // Local storage
      const filepath = this.getLocalPath(key);
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      } catch (err) {
        console.warn(`Failed to delete local file ${filepath}:`, err.message);
      }
    }
  }

  /**
   * Check if a file exists in storage.
   * @param {string} key - Storage key/path
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    this.init();

    if (this.provider === 's3') {
      try {
        await this.s3.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }));
        return true;
      } catch (err) {
        return false;
      }
    } else {
      return fs.existsSync(this.getLocalPath(key));
    }
  }

  /**
   * Get a presigned URL for direct browser-to-S3 uploads.
   * This bypasses the server for large file uploads.
   * @param {string} key - Storage key/path
   * @param {string} contentType - MIME type
   * @param {number} expiresIn - URL expiration in seconds (default: 1 hour)
   * @returns {Promise<{uploadUrl: string, publicUrl: string} | null>}
   */
  async getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    this.init();

    if (this.provider !== 's3') {
      // Local storage doesn't support presigned URLs
      return null;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });
    const publicUrl = `${this.publicUrl}/${this.bucket}/${key}`;

    return { uploadUrl, publicUrl, key };
  }

  /**
   * Get a presigned URL for downloading a private file.
   * @param {string} key - Storage key/path
   * @param {number} expiresIn - URL expiration in seconds (default: 1 hour)
   * @returns {Promise<string | null>}
   */
  async getPresignedDownloadUrl(key, expiresIn = 3600) {
    this.init();

    if (this.provider !== 's3') {
      return null;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Get the local filesystem path for a key.
   * @param {string} key - Storage key/path
   * @returns {string}
   */
  getLocalPath(key) {
    if (typeof key !== 'string' || !key || key.includes('\\')) {
      throw new Error('Invalid storage key');
    }
    const root = path.resolve(this.uploadsDir);
    const filepath = path.resolve(root, key);
    const relative = path.relative(root, filepath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Storage key must stay within the uploads directory');
    }
    return filepath;
  }

  /**
   * Get the URL path for a locally stored file.
   * @param {string} key - Storage key/path
   * @returns {string}
   */
  getLocalUrl(key) {
    if (key.startsWith('media/')) {
      return `/api/media/${key.replace('media/', '')}`;
    } else {
      return `/uploads/${key}`;
    }
  }

  /**
   * Check if S3 storage is enabled.
   * @returns {boolean}
   */
  isS3Enabled() {
    this.init();
    return this.provider === 's3';
  }

  /**
   * Get storage info for status display.
   * @returns {object}
   */
  getInfo() {
    this.init();
    return {
      provider: this.provider,
      bucket: this.bucket || null,
      endpoint: this.provider === 's3' ? process.env.S3_ENDPOINT : null,
    };
  }
}

// Singleton instance
export const storage = new StorageProvider();
