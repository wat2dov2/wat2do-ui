import { queryOptions } from "@tanstack/react-query";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { controlBox } from "@/shared/config/controlBox";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export type MapCoordinates = [longitude: number, latitude: number];
export interface EventMapLocations {
  center: MapCoordinates;
  locations: Record<string, MapCoordinates | null>;
  failedCount: number;
}

interface MapboxSearchResponse {
  features: { geometry: { type: string; coordinates: number[] }; properties: { feature_type: string; name?: string; full_address?: string } }[];
}

function venueName(location: string): string | null {
  const name = location.replace(/\b(?:room|rm\.?|suite|floor)\s*#?\s*[\w-]+/gi, "")
    .replace(/^(?!\d)(.*?)\s+\d{3,4}[a-z]?$/i, "$1")
    .replace(/^[\s,;-]+|[\s,;-]+$/g, "").trim();
  return !name || /^(?:[a-z]{1,2}|tbd|tba|unknown|n\/a)$/i.test(name) ? null : name;
}

function matchesVenue(name: string, feature: MapboxSearchResponse["features"][number]): boolean {
  const words = (value: string) => value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const expected = words(name).filter(word => (word.length > 1 || /^\d+$/.test(word)) && !["the", "of", "at", "in"].includes(word));
  // Short campus room/building codes have no reliable public lookup. An address
  // result is valid only for a venue that actually supplies a street number.
  if (!expected.length) return false;
  const address = feature.properties.feature_type === "address";
  if (address && !/^\d/.test(name)) return false;
  const actual = new Set(words(address ? feature.properties.full_address ?? "" : feature.properties.name ?? ""));
  return expected.every(word => actual.has(word));
}

async function searchLocation(query: string, near: string, signal?: AbortSignal, venue?: string): Promise<MapCoordinates | null> {
  const params = new URLSearchParams({
    q: query.slice(0, 256), near, limit: "5", types: "poi,address", access_token: MAPBOX_TOKEN,
  });
  const timeout = AbortSignal.timeout(controlBox.eventDiscovery.views.map_search_timeout_seconds * 1000);
  const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Mapbox location lookup failed (${response.status})`);
  const result: MapboxSearchResponse = await response.json();
  const feature = result.features.find(({ geometry, properties }) =>
    geometry.type === "Point" && ["poi", "address"].includes(properties.feature_type) &&
    (!venue || matchesVenue(venue, { geometry, properties })));
  const coordinates = feature?.geometry.coordinates;
  if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return null;
  return [coordinates[0], coordinates[1]];
}

/** Session-only query cache: Mapbox Search Box results are never persisted. */
function locationQuery(school: string, query: string, near: string, venue?: string) {
  return queryOptions({
    queryKey: queryKeys.events.mapLocation(school, query),
    queryFn: ({ signal }) => searchLocation(query, near, signal, venue),
    staleTime: Infinity,
    retry: false,
  });
}

export function eventMapLocationsQuery(schoolSlug: string, school: SchoolSummary | undefined, locations: string[]) {
  const sortedLocations = [...new Set(locations)].sort();
  return queryOptions({
    queryKey: queryKeys.events.mapLocations(schoolSlug, sortedLocations),
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }): Promise<EventMapLocations> => {
      if (!school) throw new Error("School directory is unavailable");
      const client = getQueryClient();
      const context = school.city || school.name;
      const center = await client.fetchQuery(locationQuery(school.slug, `${school.name}, ${context}`, context));
      if (!center) throw new Error("School location could not be found");
      const found: EventMapLocations = { center, locations: {}, failedCount: 0 };
      let next = 0;
      // Repeated venues share one query. Bound concurrent lookups and stop scheduling
      // when this map unmounts or its school/filter selection changes.
      await Promise.all(Array.from({ length: Math.min(sortedLocations.length, controlBox.eventDiscovery.views.map_search_concurrency) }, async () => {
        while (next < sortedLocations.length) {
          signal.throwIfAborted();
          const location = sortedLocations[next++];
          try {
            const venue = venueName(location);
            if (!venue) {
              found.locations[location] = null;
              continue;
            }
            found.locations[location] = await client.fetchQuery(locationQuery(school.slug, `${venue}, ${context}`, center.join(","), venue));
          } catch {
            signal.throwIfAborted();
            found.locations[location] = null;
            found.failedCount++;
          }
        }
      }));
      return found;
    },
  });
}
