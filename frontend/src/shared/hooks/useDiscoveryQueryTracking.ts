import { useEffect, useRef } from "react";
import type { components } from "@/shared/generated/api-types";
import { trackDiscoveryQuery } from "@/shared/services/trackingService";

type DiscoveryQuery = components["schemas"]["DiscoveryQueryCreate"];

/** Observe applied queries, including empty searches and filter-only changes.
 * Submission distinguishes a repeated intentional search from an ordinary render.
 */
export function useDiscoveryQueryTracking(
  query: Pick<DiscoveryQuery, "school" | "surface" | "search_query" | "filters">,
  submission = 0,
) {
  const serialized = JSON.stringify(query);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const key = `${submission}:${serialized}`;
    if (previous.current === key) return;
    previous.current = key;
    try {
      trackDiscoveryQuery({
        ...JSON.parse(serialized),
        id: crypto.randomUUID(),
        page_url: window.location.href,
      });
    } catch {
      // Unsupported/blocked telemetry must never interrupt the listing.
    }
  }, [serialized, submission]);
}
