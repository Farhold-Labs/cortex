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
 *
 * Every URL handed out is a Cortex URL — /uploads/<key>, or /api/media/<file>
 * for recordings — whichever provider holds the file (v2.117.0). With S3 the
 * bucket stays private and Cortex streams the object (see stream()) after the
 * same wave check it applies to a file on disk. Handing out bucket links would
 * have meant either a public bucket, which skips that check, or a private one,
 * whose links simply fail.
 */

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { deleteAllVersions } from './lib/s3-delete.js';

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

    // Kept in S3 mode too: files written before a node switched to S3 are
    // still on disk, and are served and deleted from there.
    this.uploadsDir = path.join(process.cwd(), 'uploads');

    if (this.provider === 'local') {
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
      }));

      // A Cortex URL, not the bucket's: the bucket is private (v2.117.0).
      return this.getLocalUrl(key);
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
   * @returns {Promise<boolean>} false if the file may still exist
   */
  async delete(key) {
    this.init();
    // Returns false when the file may still exist, so a caller that must
    // retry (the attachment sweep) can tell (v2.117.0). Callers that only
    // tidy up can ignore it.
    let ok = true;

    if (this.provider === 's3') {
      try {
        // Every version: on B2 a plain delete only hides the file.
        await deleteAllVersions(this.s3, this.bucket, key);
      } catch (err) {
        console.warn(`Failed to delete S3 object ${key}:`, err.message);
        ok = false;
      }
    }

    // Local storage — and in S3 mode, a file stored before the node switched.
    try {
      const filepath = this.getLocalPath(key);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch (err) {
      console.warn(`Failed to delete local file ${key}:`, err.message);
      ok = false;
    }
    return ok;
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
        await this.s3.send(new HeadObjectCommand({
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
   * Stream an object from S3 to an HTTP response (v2.117.0).
   *
   * Call only after the caller's access check has passed; this does none.
   * Honours one byte Range so players can seek, and If-None-Match so a cached
   * copy is revalidated rather than downloaded again. Returns false, having
   * written nothing, when the object does not exist, so the caller can answer
   * 404 in its own words.
   *
   * The Content-Type is the caller's, decided from the file's extension: the
   * type stored with the object came from the uploader's browser, and serving
   * it back would let an upload choose to be rendered as HTML.
   */
  async stream(key, req, res, { contentType }) {
    this.init();
    if (this.provider !== 's3') return false;
    const range = parseRange(req.headers.range);
    const params = { Bucket: this.bucket, Key: key };
    if (range) params.Range = range;
    if (req.headers['if-none-match']) params.IfNoneMatch = req.headers['if-none-match'];
    let obj;
    try {
      obj = await this.s3.send(req.method === 'HEAD' ? new HeadObjectCommand(params) : new GetObjectCommand(params));
    } catch (err) {
      const status = err?.$metadata?.httpStatusCode;
      if (status === 304 || status === 416) {
        res.status(status).end();
        return true;
      }
      if (status === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound') return false;
      throw err;
    }
    res.status(obj.ContentRange ? 206 : 200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (obj.ContentLength != null) res.setHeader('Content-Length', String(obj.ContentLength));
    if (obj.ContentRange) res.setHeader('Content-Range', obj.ContentRange);
    if (obj.ETag) res.setHeader('ETag', obj.ETag);
    if (obj.LastModified) res.setHeader('Last-Modified', new Date(obj.LastModified).toUTCString());
    // Revalidate every time: whether this viewer may see the file is decided
    // per request, and a shared cache must never hold a private wave's file.
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.method === 'HEAD' || !obj.Body) {
      res.end();
      return true;
    }
    const body = obj.Body;
    req.on('close', () => body.destroy?.());
    body.on('error', () => res.destroy());
    body.pipe(res);
    return true;
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
    const publicUrl = `/uploads/${key}`; // served through Cortex (v2.117.0)

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

/** Accept only one simple byte range (`bytes=a-b`, `bytes=a-`, `bytes=-n`); anything else is ignored. */
function parseRange(header) {
  if (typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] !== '' && m[2] !== '' && Number(m[2]) < Number(m[1])) return null;
  return `bytes=${m[1]}-${m[2]}`;
}
