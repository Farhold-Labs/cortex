// Recording live broadcasts (v2.110.0).
//
// LiveKit Egress records the broadcast's room and uploads the file directly to
// an S3-compatible bucket (Backblaze B2 in production). Cortex never handles
// the video while it is being recorded; it only starts the egress, stops it,
// and notices when the file is ready.
//
// Room composite rather than participant egress, deliberately: a participant
// egress follows one connection and ends when it drops, so a performer whose
// phone hops from wifi to mobile data mid-show would lose the rest of the
// recording. A room composite records the room for as long as it exists, and
// only the performer can publish into a broadcast room, so it records exactly
// the show.
//
// The bucket is private. Viewing streams through Cortex (see streamObject) so
// the wave-membership check runs on every request and the storage keys never
// reach a browser.

import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, EgressStatus } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/** Recording settings from the environment, or null when recording is not set up. */
export function recordingConfigFromEnv(env = process.env) {
  const cfg = {
    endpoint: env.RECORDING_S3_ENDPOINT,
    region: env.RECORDING_S3_REGION,
    bucket: env.RECORDING_S3_BUCKET,
    accessKey: env.RECORDING_S3_ACCESS_KEY,
    secretKey: env.RECORDING_S3_SECRET_KEY,
  };
  if (Object.values(cfg).some(v => !v)) return null;
  return cfg;
}

/** Object key for a broadcast's recording. Namespaced by node, since several nodes may share a bucket. */
export function recordingKey(nodeName, broadcastId) {
  const node = String(nodeName || 'cortex').toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  return `${node}/broadcasts/${broadcastId}.mp4`;
}

// Egress states after which no more of the file will be written.
const FINISHED = new Set([EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED]);

export class BroadcastRecorder {
  constructor({ config, livekitUrl, apiKey, apiSecret, egressClient = null, s3Client = null }) {
    this.config = config;
    this.egress = egressClient || new EgressClient(livekitUrl, apiKey, apiSecret);
    this.s3 = s3Client || new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  /** Start recording a room into `key`. Returns the egress id. */
  async start(roomName, key) {
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: key,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: this.config.accessKey,
          secret: this.config.secretKey,
          region: this.config.region,
          endpoint: this.config.endpoint,
          bucket: this.config.bucket,
          forcePathStyle: true,
          contentDisposition: 'inline',
        }),
      },
    });
    // 'speaker' puts the one publisher full frame; viewers are hidden, so
    // they never appear in it.
    const info = await this.egress.startRoomCompositeEgress(roomName, { file: output }, { layout: 'speaker' });
    return info.egressId;
  }

  /** Ask the egress to finish. Already-finished is not an error. */
  async stop(egressId) {
    try {
      await this.egress.stopEgress(egressId);
    } catch (err) {
      // LiveKit refuses to stop an egress that has already ended — fine.
      if (!/not.*(active|found)|already|failed_precondition|EGRESS_(COMPLETE|FAILED|ABORTED)/i.test(String(err?.message))) throw err;
    }
  }

  /**
   * Where an egress has got to. `settled` is false while it is still running
   * or uploading; once true, `ok` says whether there is a usable file.
   */
  async check(egressId) {
    const [info] = await this.egress.listEgress({ egressId });
    if (!info) return { settled: true, ok: false, error: 'egress not found' };
    if (!FINISHED.has(info.status)) return { settled: false };
    const file = info.fileResults?.[0] || (info.result?.case === 'file' ? info.result.value : null);
    const size = file ? Number(file.size || 0) : 0;
    // A time-limited or aborted egress still leaves a playable file behind;
    // keep whatever was recorded rather than throwing a whole show away.
    return {
      settled: true,
      ok: size > 0,
      size,
      durationMs: file ? Math.round(Number(file.duration || 0) / 1e6) : 0,
      error: info.error || null,
    };
  }

  async remove(key) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /**
   * Stream a recording to the response, honouring a single byte Range so
   * the browser's player can seek without downloading the whole show.
   */
  async streamObject(key, req, res) {
    const range = parseRange(req.headers.range);
    let obj;
    try {
      obj = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range: range || undefined }));
    } catch (err) {
      const status = err?.$metadata?.httpStatusCode;
      if (status === 416) return res.status(416).end();
      if (status === 404 || err?.name === 'NoSuchKey') return res.status(404).json({ error: 'Recording not found' });
      throw err;
    }
    res.status(obj.ContentRange ? 206 : 200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (obj.ContentLength != null) res.setHeader('Content-Length', String(obj.ContentLength));
    if (obj.ContentRange) res.setHeader('Content-Range', obj.ContentRange);
    // Private: the URL carries a viewer-specific token.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const body = obj.Body;
    req.on('close', () => body.destroy?.());
    body.on('error', () => res.destroy());
    body.pipe(res);
  }
}

/** Accept only one simple byte range (`bytes=a-b`, `bytes=a-`, `bytes=-n`); anything else is ignored. */
export function parseRange(header) {
  if (typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] !== '' && m[2] !== '' && Number(m[2]) < Number(m[1])) return null;
  return `bytes=${m[1]}-${m[2]}`;
}
