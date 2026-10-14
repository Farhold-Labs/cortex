/**
 * Delete an object from S3-compatible storage — every version of it (v2.117.0).
 *
 * A plain DeleteObject on a versioned bucket only hides the file: it adds a
 * delete marker and keeps the data. Backblaze B2 buckets keep every version
 * unless a lifecycle rule says otherwise, so "deleted" attachments and
 * broadcast recordings were still in the bucket, still billed, and still
 * readable by anyone holding the bucket's keys. Deleting by version id is what
 * actually removes the data.
 *
 * Only versions of exactly this key are touched (the listing is by prefix, so
 * 'a.png' would also list 'a.png.bak'). If the provider does not support
 * listing versions, this falls back to a plain delete, which on an unversioned
 * bucket is already permanent.
 */
import { DeleteObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';

export async function deleteAllVersions(s3, bucket, key) {
  let versions;
  try {
    versions = [];
    let KeyMarker, VersionIdMarker;
    do {
      const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker, VersionIdMarker }));
      for (const v of [...(page.Versions || []), ...(page.DeleteMarkers || [])]) {
        if (v.Key === key && v.VersionId) versions.push(v.VersionId);
      }
      KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      VersionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (KeyMarker);
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    // Not supported here (or not permitted): a plain delete is the best available.
    if (status === 400 || status === 403 || status === 404 || status === 501) versions = null;
    else throw err;
  }

  if (!versions) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  // Nothing listed: never stored, or already gone. A plain delete is harmless
  // and covers a provider that lists nothing for unversioned objects.
  if (!versions.length) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  for (const VersionId of versions) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId }));
  }
}
