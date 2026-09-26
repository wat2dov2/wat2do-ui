import { replaceEqualDeep } from "@tanstack/react-query";
import { resolveSchool } from "@/shared/constants/schools";
import { ApiError } from "@/shared/services/apiClient";
import type { DiscoveryResource } from "@/shared/services/discoverySnapshotStore";

export interface DiscoverySnapshotMetadata {
  /** Start of the canonical snapshot's source read, in milliseconds. */
  generated_at?: number;
  /** Client-only timestamp of the latest confirmed write merged into this snapshot. */
  confirmed_at?: number;
}

/** Public browser reads use the same complete snapshots as server rendering. */
export async function fetchDiscoverySnapshot<T>(
  school: string,
  resource: Extract<DiscoveryResource, "events" | "positions" | "clubs">,
): Promise<T> {
  const params = new URLSearchParams({
    school: resolveSchool(school),
    resource,
  });
  const response = await fetch(`/api/discovery?${params}`, {
    credentials: "omit",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  if (body === null) throw new Error("Discovery snapshot response is empty");
  return body as T;
}

/** A delayed refresh cannot undo a newer generation or a confirmed local write. */
export function preserveDiscoveryGeneration(
  current: unknown,
  incoming: unknown,
): unknown {
  const previous = current as DiscoverySnapshotMetadata | undefined;
  const next = incoming as DiscoverySnapshotMetadata;
  const previousVersion = Math.max(
    previous?.generated_at ?? 0,
    previous?.confirmed_at ?? 0,
  );
  const incomingVersion = Math.max(
    next.generated_at ?? 0,
    next.confirmed_at ?? 0,
  );
  if (incomingVersion > 0 && incomingVersion < previousVersion) return current;
  return replaceEqualDeep(current, incoming);
}
