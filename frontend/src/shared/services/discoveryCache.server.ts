import { Readable } from "node:stream";
import controls from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DiscoverySnapshotStore,
  type DiscoveryResource,
  type SnapshotStorage,
} from "@/shared/services/discoverySnapshotStore";

/** A single deadline covers SDK retries, response headers, and the complete body. */
export class S3SnapshotStorage implements SnapshotStorage {
  constructor(
    private bucket: string,
    private client = new S3Client({}),
  ) {}

  async get(key: string) {
    const signal = AbortSignal.timeout(controls.request_timeout_seconds * 1000);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      const body = result.Body;
      if (!(body instanceof Readable))
        throw new Error("Discovery storage returned no Node response stream");
      const abortBody = () => {
        body.destroy(signal.reason);
      };
      signal.addEventListener("abort", abortBody, { once: true });
      try {
        signal.throwIfAborted();
        const value = await body.transformToString();
        signal.throwIfAborted();
        return { value, etag: result.ETag! };
      } finally {
        signal.removeEventListener("abort", abortBody);
        if (signal.aborted) body.destroy();
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NoSuchKey" || error.name === "NotFound")
      )
        return null;
      throw error;
    }
  }

  async put(key: string, value: string, etag?: string) {
    const signal = AbortSignal.timeout(controls.request_timeout_seconds * 1000);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: value,
          ContentType: "application/json",
          CacheControl: key.endsWith("/state.json")
            ? "no-store"
            : "public, max-age=31536000, immutable",
          ServerSideEncryption: "AES256",
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
        }),
        { abortSignal: signal },
      );
      signal.throwIfAborted();
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "PreconditionFailed" ||
          error.name === "ConditionalRequestConflict")
      )
        return false;
      throw error;
    }
  }
}
const bucket = process.env.STORAGE_BUCKET_NAME;
export const discoveryStore = bucket
  ? new DiscoverySnapshotStore(new S3SnapshotStorage(bucket))
  : null;

export async function readDiscoverySnapshot<T>(
  school: string,
  resource: DiscoveryResource,
  build: () => Promise<T>,
): Promise<T & { generated_at: number }> {
  if (!discoveryStore) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.PLAYWRIGHT_TEST !== "1"
    )
      throw new Error(
        "STORAGE_BUCKET_NAME is required for discovery snapshots",
      );
    const generatedAt = Date.now();
    const data = await build();
    return withGeneration(data, generatedAt);
  }
  const existing = await discoveryStore.read<T>(school, resource);
  if (existing) return withGeneration(existing.data, existing.generatedAt);
  // Provisioning normally happens before readiness. This also handles first-ever schools.
  await discoveryStore.refresh(school, resource, build);
  const snapshot = await discoveryStore.read<T>(school, resource);
  if (!snapshot)
    throw new Error(`Discovery snapshot unavailable: ${school}/${resource}`);
  return withGeneration(snapshot.data, snapshot.generatedAt);
}

function withGeneration<T>(
  data: T,
  generatedAt: number,
): T & { generated_at: number } {
  // School lookup preserves its null/404 contract; arrays remain arrays.
  return (
    data === null ? null : Object.assign(data, { generated_at: generatedAt })
  ) as T & { generated_at: number };
}
