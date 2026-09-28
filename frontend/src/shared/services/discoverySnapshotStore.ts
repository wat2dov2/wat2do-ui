import { randomUUID } from "node:crypto";
import control from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };

export type DiscoveryResource =
  "events" | "positions" | "clubs" | "branding" | "schools" | "site-banner";
export interface Snapshot<T> {
  data: T;
  generatedAt: number;
  revision: string;
}
interface State {
  requested: string;
  completed?: string;
  payloadKey?: string;
  generatedAt?: number;
  lease?: { owner: string; until: number };
  retryAt?: number;
  lastError?: string;
}
export interface StoredObject {
  value: string;
  etag: string;
}
export interface SnapshotStorage {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: string, etag?: string): Promise<boolean>;
}

/** One durable state record publishes immutable, complete generations with CAS. */
export class DiscoverySnapshotStore {
  private snapshots = new Map<
    string,
    { snapshot: Snapshot<unknown>; payloadKey: string; checkedAt: number }
  >();
  private reads = new Map<string, Promise<Snapshot<unknown> | null>>();
  constructor(
    private storage: SnapshotStorage,
    private now = Date.now,
  ) {}

  private key(school: string, resource: DiscoveryResource) {
    if (!/^[a-z0-9_-]+$/.test(school))
      throw new Error("Invalid discovery school");
    return `${control.storage_prefix}/v${control.schema_version}/${school}/${resource}/state.json`;
  }

  private async state(school: string, resource: DiscoveryResource) {
    const object = await this.storage.get(this.key(school, resource));
    return {
      state: object ? (JSON.parse(object.value) as State) : undefined,
      etag: object?.etag,
    };
  }

  async invalidate(school: string, resource: DiscoveryResource): Promise<void> {
    const requested = randomUUID();
    for (let attempt = 0; attempt < control.state_write_attempts; attempt++) {
      const { state, etag } = await this.state(school, resource);
      if (
        await this.storage.put(
          this.key(school, resource),
          JSON.stringify({ ...state, requested, retryAt: 0 }),
          etag,
        )
      )
        return;
    }
    throw new Error("Discovery invalidation contention");
  }

  async inspect(school: string, resource: DiscoveryResource) {
    const { state } = await this.state(school, resource);
    return {
      school,
      resource,
      ready: Boolean(
        state?.payloadKey &&
        this.now() - state.generatedAt! <
          control.maximum_snapshot_age_seconds * 1000,
      ),
      generatedAt: state?.generatedAt ?? null,
      dirty: !state || state.requested !== state.completed,
      refreshing: Boolean(state?.lease && state.lease.until > this.now()),
      retryAt: state?.retryAt ?? null,
      lastError: state?.lastError ?? null,
    };
  }

  async read<T>(
    school: string,
    resource: DiscoveryResource,
  ): Promise<Snapshot<T> | null> {
    const key = this.key(school, resource);
    const cached = this.snapshots.get(key);
    const now = this.now();
    if (
      cached &&
      now - cached.checkedAt < control.worker_interval_seconds * 1000 &&
      now - cached.snapshot.generatedAt <
        control.maximum_snapshot_age_seconds * 1000
    )
      return cached.snapshot as Snapshot<T>;

    let pending = this.reads.get(key);
    if (!pending) {
      pending = this.load(school, resource, key).finally(() =>
        this.reads.delete(key),
      );
      this.reads.set(key, pending);
    }
    return pending as Promise<Snapshot<T> | null>;
  }

  private async load(
    school: string,
    resource: DiscoveryResource,
    key: string,
  ): Promise<Snapshot<unknown> | null> {
    const cached = this.snapshots.get(key);
    const { state } = await this.state(school, resource);
    const published = this.snapshots.get(key);
    if (published && published !== cached) return published.snapshot;
    if (
      !state?.payloadKey ||
      this.now() - state.generatedAt! >=
        control.maximum_snapshot_age_seconds * 1000
    ) {
      this.snapshots.delete(key);
      return null;
    }
    if (cached?.payloadKey === state.payloadKey) {
      cached.checkedAt = this.now();
      return cached.snapshot;
    }
    const payload = await this.storage.get(state.payloadKey);
    const latest = this.snapshots.get(key);
    if (latest && latest !== cached) return latest.snapshot;
    if (!payload) throw new Error("Published discovery payload is missing");
    const snapshot = {
      data: JSON.parse(payload.value) as unknown,
      generatedAt: state.generatedAt!,
      revision: state.completed!,
    };
    this.snapshots.set(key, {
      snapshot,
      payloadKey: state.payloadKey,
      checkedAt: this.now(),
    });
    return snapshot;
  }

  async refresh<T>(
    school: string,
    resource: DiscoveryResource,
    build: () => Promise<T>,
  ): Promise<boolean> {
    const { state, etag } = await this.state(school, resource);
    const now = this.now();
    if (state?.lease && state.lease.until > now) return false;
    if (state?.retryAt && state.retryAt > now) return false;
    if (
      state?.payloadKey &&
      state.completed === state.requested &&
      now - state.generatedAt! < control.refresh_interval_seconds * 1000
    )
      return false;
    const owner = randomUUID();
    const requested = state?.requested ?? randomUUID();
    const leased: State = {
      ...state,
      requested,
      lease: { owner, until: now + control.lease_seconds * 1000 },
    };
    if (
      !(await this.storage.put(
        this.key(school, resource),
        JSON.stringify(leased),
        etag,
      ))
    )
      return false;
    let heartbeatBusy = false;
    const heartbeat = setInterval(
      async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
          await this.updateLease(school, resource, owner, (current) => ({
            ...current,
            lease: { owner, until: this.now() + control.lease_seconds * 1000 },
          }));
        } catch (error) {
          console.error("Discovery lease renewal failed", {
            school,
            resource,
            error,
          });
        } finally {
          heartbeatBusy = false;
        }
      },
      (control.lease_seconds * 1000) / 3,
    );
    heartbeat.unref();
    try {
      const data = await build();
      const generatedAt = now;
      const payloadKey = `${control.storage_prefix}/generations/v${control.schema_version}/${school}/${resource}/${owner}.json`;
      if (!(await this.storage.put(payloadKey, JSON.stringify(data))))
        throw new Error("Discovery generation already exists");
      let currentRevision = false;
      const updated = await this.updateLease(
        school,
        resource,
        owner,
        (current) => {
          currentRevision = current.requested === requested;
          return currentRevision
            ? {
                ...current,
                completed: requested,
                payloadKey,
                generatedAt,
                lease: undefined,
                retryAt: 0,
                lastError: undefined,
              }
            : { ...current, lease: undefined };
        },
      );
      const published = updated && currentRevision;
      if (published) {
        this.snapshots.set(this.key(school, resource), {
          snapshot: { data, generatedAt, revision: requested },
          payloadKey,
          checkedAt: this.now(),
        });
      }
      console.info("discovery_refresh", {
        school,
        resource,
        published,
        durationMs: this.now() - now,
        bytes: Buffer.byteLength(JSON.stringify(data)),
      });
      return published;
    } catch (error) {
      // Keep the published pointer untouched. A later worker retries durable dirty state.
      await this.updateLease(school, resource, owner, (current) => ({
        ...current,
        lease: undefined,
        retryAt: this.now() + control.failure_backoff_seconds * 1000,
        lastError:
          error instanceof Error ? error.message : "Snapshot refresh failed",
      }));
      console.error("discovery_refresh_failed", {
        school,
        resource,
        durationMs: this.now() - now,
        error,
      });
      return false;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async updateLease(
    school: string,
    resource: DiscoveryResource,
    owner: string,
    update: (state: State) => State,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < control.state_write_attempts; attempt++) {
      const { state, etag } = await this.state(school, resource);
      if (state?.lease?.owner !== owner || state.lease.until <= this.now())
        return false;
      if (
        await this.storage.put(
          this.key(school, resource),
          JSON.stringify(update(state)),
          etag,
        )
      )
        return true;
    }
    throw new Error("Discovery publication contention");
  }
}
