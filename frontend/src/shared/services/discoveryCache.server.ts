import { unstable_cache } from "next/cache";
import type { DiscoveryResource } from "@/shared/api/discovery.api";
import control from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };

// The school directory and the site banner are shared by every school.
const globalResources = new Set<DiscoveryResource>(["schools", "site-banner"]);

/** The cache tag of one school's resource, or of a resource every school shares. */
export function discoveryTag(school: string, resource: DiscoveryResource) {
  const scope = globalResources.has(resource) ? "_global" : school;
  return `discovery:v${control.schema_version}:${scope}:${resource}`;
}

/**
 * One complete snapshot per school and resource, kept in Next's data cache,
 * which every server instance and deployment shares (S3 and DynamoDB on AWS, frontend/open-next.config.ts).
 * The backend's revalidation notice marks a snapshot stale, and so does age
 * past `refresh_interval_seconds`; the next read serves the stale copy while
 * one rebuild runs. A failed rebuild keeps the last complete snapshot, since
 * `build` throws rather than return a partial catalog.
 * `generated_at` records when the rebuild's source reads began.
 */
export async function readDiscoverySnapshot<T>(
  school: string,
  resource: DiscoveryResource,
  build: () => Promise<T>,
): Promise<T & { generated_at: number }> {
  const tag = discoveryTag(school, resource);
  const read = async () => {
    const generatedAt = Date.now();
    return { data: await build(), generatedAt };
  };
  // Browser tests give each request its own API fixtures, so nothing may be
  // cached between them.
  const snapshot =
    process.env.PLAYWRIGHT_TEST === "1"
      ? await read()
      : await unstable_cache(read, [tag], {
          tags: [tag],
          revalidate: control.refresh_interval_seconds,
        })();
  // School lookup preserves its null/404 contract; arrays remain arrays.
  return (
    snapshot.data === null
      ? null
      : Object.assign(snapshot.data, { generated_at: snapshot.generatedAt })
  ) as T & { generated_at: number };
}
