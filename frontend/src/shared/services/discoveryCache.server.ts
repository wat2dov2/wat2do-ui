import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DiscoverySnapshotStore,
  type DiscoveryResource,
  type SnapshotStorage,
} from "@/shared/services/discoverySnapshotStore";

// Instrumentation and routes are separate Next bundles, but share one warm store
// and one set of write locks.
const processState = globalThis as typeof globalThis & {
  discoverySnapshotStore?: DiscoverySnapshotStore;
  discoverySnapshotLocks?: Map<string, Promise<unknown>>;
};
const locks = (processState.discoverySnapshotLocks ??= new Map());

/**
 * Snapshot files under one directory that only this process writes.
 * The etag is the SHA-256 of a file's content. A conditional write holds the
 * process-wide lock for its file while it compares, then renames a complete
 * temporary file into place, so readers see either the old file or the new one.
 */
export class FileSnapshotStorage implements SnapshotStorage {
  private root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root))
      throw new Error("DISCOVERY_CACHE_DIR must be an absolute path");
    this.root = path.resolve(root);
  }

  async get(key: string) {
    const value = await readIfPresent(this.file(key));
    return value === null ? null : { value, etag: contentEtag(value) };
  }

  async put(key: string, value: string, etag?: string) {
    const file = this.file(key);
    return withLock(file, async () => {
      const current = await readIfPresent(file);
      const matches =
        etag === undefined
          ? current === null
          : current !== null && contentEtag(current) === etag;
      if (!matches) return false;
      await writeAtomically(file, value);
      return true;
    });
  }

  async deleteOlderThan(prefix: string, cutoff: number) {
    const directory = this.file(prefix);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const name of names) {
      const file = path.join(directory, name);
      try {
        const info = await stat(file);
        if (info.isFile() && info.mtimeMs < cutoff)
          await rm(file, { force: true });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }

  private file(key: string) {
    const file = path.resolve(this.root, key);
    if (
      key
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      !file.startsWith(this.root + path.sep)
    )
      throw new Error(`Invalid discovery storage key: ${key}`);
    return file;
  }
}

function contentEtag(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

async function readIfPresent(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Runs `write` once every earlier write to `file` in this process has settled. */
async function withLock<T>(file: string, write: () => Promise<T>): Promise<T> {
  const result = (locks.get(file) ?? Promise.resolve()).then(write);
  const settled = result.catch(() => undefined);
  locks.set(file, settled);
  try {
    return await result;
  } finally {
    if (locks.get(file) === settled) locks.delete(file);
  }
}

async function writeAtomically(file: string, value: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  try {
    // Flushed before the rename, so a crash cannot leave a truncated file.
    await writeFile(temporary, value, { flush: true });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

const directory = process.env.DISCOVERY_CACHE_DIR;
export const discoveryStore = directory
  ? (processState.discoverySnapshotStore ??= new DiscoverySnapshotStore(
      new FileSnapshotStorage(directory),
    ))
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
        "DISCOVERY_CACHE_DIR is required for discovery snapshots",
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
