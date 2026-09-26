import controls from "../../../../backend/controlbox/image_delivery.json" with { type: "json" };
import type { DiscoveryResource } from "@/shared/services/discoverySnapshotStore";

interface Registration {
  urls: Set<string>;
  updatedAt: number;
}
interface ImageJob {
  source: string;
  width: number;
  nextAt: number;
}

/** Serial, best-effort warming of the current first screen at the public CDN. */
export class DiscoveryImageWarmer {
  private registrations = new Map<string, Registration>();
  private jobs = new Map<string, ImageJob>();
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private fetchImage: typeof fetch = (input, init) => fetch(input, init),
    private now = Date.now,
  ) {}

  warm(
    school: string,
    resource: DiscoveryResource,
    data: unknown,
  ): Promise<void> {
    if (this.disposed || (resource !== "events" && resource !== "positions"))
      return Promise.resolve();
    const items =
      data &&
      typeof data === "object" &&
      "items" in data &&
      Array.isArray(data.items)
        ? data.items
        : [];
    const urls = new Set<string>();
    for (const item of items.slice(0, controls.first_row_image_count)) {
      const source = item?.source_image_url;
      if (typeof source !== "string") continue;
      try {
        const url = new URL(source);
        // Warming is deliberately limited to our media origin; it never fetches
        // arbitrary legacy sources, relative page URLs, or third-party assets.
        if (
          url.origin !== `https://${controls.optimized_remote_host}` ||
          !url.pathname.startsWith(controls.optimized_remote_path)
        )
          continue;
        urls.add(source);
      } catch {
        /* Invalid and missing posters retain the regular UI fallback. */
      }
    }
    const key = `${school}/${resource}`;
    if (urls.size) this.registrations.set(key, { urls, updatedAt: this.now() });
    else this.registrations.delete(key);
    this.reconcileJobs();
    return this.drain();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.registrations.clear();
    this.jobs.clear();
  }

  private reconcileJobs(): void {
    const now = this.now();
    const desired = new Set<string>();
    for (const [key, registration] of this.registrations) {
      if (
        now - registration.updatedAt >=
        controls.warm_success_ttl_seconds * 1000
      ) {
        this.registrations.delete(key);
        continue;
      }
      for (const source of registration.urls)
        for (const width of controls.warm_widths) {
          const url = new URL(
            `https://${controls.optimized_remote_host}/_next/image`,
          );
          url.search = new URLSearchParams({
            url: source,
            w: String(width),
            q: String(controls.quality),
          }).toString();
          const variant = url.toString();
          desired.add(variant);
          if (!this.jobs.has(variant))
            this.jobs.set(variant, { source, width, nextAt: now });
        }
    }
    for (const url of this.jobs.keys())
      if (!desired.has(url)) this.jobs.delete(url);
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.running = this.processJobs().finally(() => {
      this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  private async processJobs(): Promise<void> {
    for (;;) {
      this.reconcileJobs();
      const next = [...this.jobs].find(([, job]) => job.nextAt <= this.now());
      if (!next || this.disposed) return;
      const [url, job] = next;
      const started = this.now();
      try {
        const response = await this.fetchImage(url, {
          headers: { Accept: controls.optimized_format },
          signal: AbortSignal.timeout(
            controls.warm_request_timeout_seconds * 1000,
          ),
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("image/")
        ) {
          await response.body?.cancel();
          throw new Error(`Image optimizer returned ${response.status}`);
        }
        if (!(await response.arrayBuffer()).byteLength)
          throw new Error("Image optimizer returned an empty image");
        job.nextAt = this.now() + controls.warm_success_ttl_seconds * 1000;
        console.info("discovery_image_warm", {
          source: job.source,
          width: job.width,
          durationMs: this.now() - started,
        });
      } catch (error) {
        job.nextAt = this.now() + controls.warm_retry_seconds * 1000;
        console.error("discovery_image_warm_failed", {
          source: job.source,
          width: job.width,
          error,
        });
      }
    }
  }

  private schedule(): void {
    if (this.disposed || !this.jobs.size) return;
    const deadlines = [
      ...[...this.jobs.values()].map((job) => job.nextAt),
      ...[...this.registrations.values()].map(
        (registration) =>
          registration.updatedAt + controls.warm_success_ttl_seconds * 1000,
      ),
    ];
    this.timer = setTimeout(
      () => {
        void this.drain();
      },
      Math.max(0, Math.min(...deadlines) - this.now()),
    );
    this.timer.unref();
  }
}

const warmer = new DiscoveryImageWarmer();

/** Image work never delays publication or another school's catalog readiness. */
export function warmDiscoveryImages(
  school: string,
  resource: DiscoveryResource,
  data: unknown,
): void {
  void warmer
    .warm(school, resource, data)
    .catch((error) =>
      console.error("discovery_image_queue_failed", {
        school,
        resource,
        error,
      }),
    );
}
