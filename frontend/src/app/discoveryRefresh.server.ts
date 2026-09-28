import { buildSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { buildPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import { buildClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import {
  getSchoolDirectory,
  buildSchoolSnapshot,
  buildSchoolDirectorySnapshot,
} from "@/shared/api/schools.server";
import { buildSiteBannerSnapshot } from "@/shared/api/siteBanner.server";
import { warmDiscoveryImages } from "@/shared/services/discoveryImages.server";
import { discoveryStore } from "@/shared/services/discoveryCache.server";
import type { DiscoveryResource } from "@/shared/services/discoverySnapshotStore";
import controls from "../../../backend/controlbox/discovery_cache.json" with { type: "json" };

export const discoveryResources = [
  "events",
  "positions",
  "clubs",
  "branding",
] as const;
const builders = {
  events: buildSchoolBrowseSnapshot,
  positions: buildPositionDirectorySnapshot,
  clubs: buildClubDirectorySnapshot,
  branding: buildSchoolSnapshot,
};
const globalBuilders = {
  schools: buildSchoolDirectorySnapshot,
  "site-banner": buildSiteBannerSnapshot,
};
const globalResources = Object.keys(globalBuilders) as Array<
  keyof typeof globalBuilders
>;
// Instrumentation and route handlers can load separate server bundles.
// Share only scheduling state so each process still has one catalog worker.
const processState = globalThis as typeof globalThis & {
  discoveryWorker?: {
    running?: Promise<void>;
    timer?: ReturnType<typeof setInterval>;
  };
};
const worker = (processState.discoveryWorker ??= {});

/** Each task serializes builds; shared per-key leases prevent duplicate builds. */
export function reconcileDiscoverySnapshots(): Promise<void> {
  if (worker.running) return worker.running;
  worker.running = reconcile().finally(() => {
    worker.running = undefined;
  });
  return worker.running;
}

async function reconcile(): Promise<void> {
  if (!discoveryStore) return;
  for (const resource of globalResources) {
    try {
      await discoveryStore.refresh<unknown>(
        "_global",
        resource,
        globalBuilders[resource],
      );
      await discoveryStore.read("_global", resource);
    } catch (error) {
      console.error("discovery_reconcile_failed", {
        school: "_global",
        resource,
        error,
      });
    }
  }
  const schools = await getSchoolDirectory();
  // Serve never-visited schools first, followed by dirty and age-expired entries.
  const states = await Promise.all(
    schools.flatMap((school) =>
      discoveryResources.map((resource) =>
        discoveryStore!.inspect(school.slug, resource),
      ),
    ),
  );
  states.sort(
    (a, b) =>
      Number(a.ready) - Number(b.ready) ||
      Number(b.dirty) - Number(a.dirty) ||
      (a.generatedAt ?? 0) - (b.generatedAt ?? 0),
  );
  for (const state of states) {
    try {
      await discoveryStore.refresh<unknown>(state.school, state.resource, () =>
        builders[state.resource as keyof typeof builders](state.school),
      );
      const snapshot = await discoveryStore.read(state.school, state.resource);
      if (snapshot)
        warmDiscoveryImages(state.school, state.resource, snapshot.data);
    } catch (error) {
      console.error("discovery_reconcile_failed", {
        school: state.school,
        resource: state.resource,
        error,
      });
    }
  }
}

export async function queueDiscoveryRefresh(
  school: string,
  resources: DiscoveryResource[],
) {
  if (!discoveryStore) return;
  for (const resource of resources) {
    await discoveryStore.invalidate(
      resource in builders ? school : "_global",
      resource,
    );
  }
}

export async function discoveryReadiness() {
  if (!discoveryStore)
    return { ready: false, schools: 0, missing: ["storage-not-configured"] };
  const schools = await getSchoolDirectory();
  const states = await Promise.all([
    ...globalResources.map((resource) =>
      discoveryStore!
        .read("_global", resource)
        .then((snapshot) => ({
          school: "_global",
          resource,
          ready: snapshot !== null,
        })),
    ),
    ...schools.flatMap((school) =>
      discoveryResources.map((resource) =>
        discoveryStore!
          .read(school.slug, resource)
          .then((snapshot) => ({
            school: school.slug,
            resource,
            ready: snapshot !== null,
          })),
      ),
    ),
  ]);
  return {
    ready: schools.length > 0 && states.every((state) => state.ready),
    schools: schools.length,
    missing: states
      .filter((state) => !state.ready)
      .map((state) => `${state.school}/${state.resource}`),
  };
}

function startDiscoveryWorker() {
  if (!discoveryStore || worker.timer) return;
  const tick = () =>
    void reconcileDiscoverySnapshots().catch((error) =>
      console.error("discovery_worker_failed", error),
    );
  tick();
  worker.timer = setInterval(tick, controls.worker_interval_seconds * 1000);
  worker.timer.unref();
}

/** Hold Next startup until global content and every school have published generations. */
export async function initializeDiscoverySnapshots(): Promise<void> {
  if (!discoveryStore) throw new Error("Discovery storage is not configured");
  const deadline = Date.now() + controls.readiness_timeout_seconds * 1000;
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      (async () => {
        while (Date.now() < deadline) {
          try {
            // A deployment can use a complete last-good generation immediately.
            // Upstream refresh failures must not delay an otherwise ready task.
            if ((await discoveryReadiness()).ready) return;
            await reconcileDiscoverySnapshots();
            if ((await discoveryReadiness()).ready) return;
          } catch (error) {
            console.error("discovery_startup_pending", error);
          }
          await new Promise((resolve) =>
            setTimeout(resolve, controls.worker_interval_seconds * 1000),
          );
        }
        throw new Error(
          "Discovery startup timed out before all schools were ready",
        );
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error("Discovery startup readiness deadline exceeded")),
          controls.readiness_timeout_seconds * 1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
  }
  startDiscoveryWorker();
}
