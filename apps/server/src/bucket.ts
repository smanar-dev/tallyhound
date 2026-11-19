// Where sealed file bytes rest in production: a private bucket that speaks the S3 API (Amazon S3, Cloudflare R2, Backblaze B2,
// Tigris and others). Everything put here was sealed with the firm's own key first (packages/core/crypto.js), so the bucket
// holds no readable document. Turn versioning OFF on the bucket: a delete must be a delete (docs/ARCHITECTURE.md).
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Bucket { put(key: string, bytes: Buffer, contentType?: string): Promise<void>; get(key: string): Promise<Buffer | null>; del(key: string): Promise<void> }
interface S3Like { send(cmd: unknown): Promise<unknown> }

export function s3Bucket(o: { bucket: string; region?: string; endpoint?: string; client?: S3Like }): Bucket {
  const s3: S3Like = o.client || new S3Client({ region: o.region || "us-east-1", ...(o.endpoint ? { endpoint: o.endpoint, forcePathStyle: true } : {}) });
  return {
    // The provider's own encryption at rest is asked for as well: two layers, different keys.
    async put(key, bytes) { await s3.send(new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: bytes, ContentType: "application/octet-stream", ServerSideEncryption: "AES256" })); },
    async get(key) {
      try { const r = (await s3.send(new GetObjectCommand({ Bucket: o.bucket, Key: key }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } }; return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null; }
      catch (err) { const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }; if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null; throw err; }
    },
    async del(key) { await s3.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key })); }   // deleting what is already gone is not an error
  };
}
