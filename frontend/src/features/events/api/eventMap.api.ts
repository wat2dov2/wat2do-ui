import { queryOptions } from "@tanstack/react-query";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { controlBox } from "@/shared/config/controlBox";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getEventStreetAddress, isVirtualLocation } from "@/shared/utils/event";

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export type MapCoordinates = [longitude: number, latitude: number];
export interface EventMapLocations {
  center: MapCoordinates;
  locations: Record<string, MapCoordinates | null>;
  failedCount: number;
  pendingCount: number;
}

interface MapboxSearchResponse {
  features: { geometry: { type: string; coordinates: number[] }; properties: { feature_type: string; name?: string; full_address?: string } }[];
}

export function venueName(location: string): string | null {
  const physical = location.split(/\s*[;|]\s*|\s+\/\s+/)
    .filter(part => part.trim() && !isVirtualLocation(part)).join(", ");
  // The map searches the building, while the event retains rooms, subvenues,
  // addresses and its online option. Those details aren't separate public POIs.
  const building = physical.replace(/\b(?:room|rm\.?|suite|floor)\s*#?\s*[\w-]+/gi, "")
    .replace(/^[\s,]+/, "").split(",")[0]
    .replace(/\s*\([A-Z][A-Z\d]{0,4}(?:\/[A-Z][A-Z\d]{0,4})*\).*$/, "");
  const name = building.replace(/^(?!\d)(.*?)\s+\d{3,4}[a-z]?$/i, "$1")
    .replace(/^[\s,;-]+|[\s,;-]+$/g, "").trim();
  return !name || /^(?:[a-z]{1,2}|tbd|tba|tbc|unknown|n\/a|hybrid|campus|on[-\s]?campus|in[-\s]?person)$/i.test(name) ? null : name;
}

function matchesVenue(name: string, feature: MapboxSearchResponse["features"][number], locality?: string): boolean {
  const address = feature.properties.feature_type === "address";
  const streetWords: Record<string, string> = {
    st: "street", ave: "avenue", rd: "road", blvd: "boulevard", dr: "drive", ln: "lane",
    cres: "crescent", ct: "court", pl: "place", ter: "terrace", trl: "trail", hwy: "highway",
    rue: "street", chemin: "road", boul: "boulevard", pkwy: "parkway", cir: "circle", sq: "square", pvt: "private", prvt: "private",
    n: "north", s: "south", e: "east", w: "west",
    nord: "north", sud: "south", est: "east", ouest: "west", o: "west",
    nw: "northwest", ne: "northeast", sw: "southwest", se: "southeast",
  };
  const words = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map(word => address ? streetWords[word] ?? word : word);
  const expected = words(name).filter(word => (word.length > 1 || /^\d+$/.test(word)) && !["the", "of", "at", "in", "and"].includes(word));
  if (locality) {
    const addressWords = new Set(words(feature.properties.full_address ?? ""));
    if (!words(locality).every(word => addressWords.has(word))) return false;
  }
  // Short campus room/building codes have no reliable public lookup. An address
  // result is valid only for a venue that actually supplies a street number.
  if (!expected.length) return false;
  if (address) {
    const requestedStreet = getEventStreetAddress(name);
    const resultStreet = getEventStreetAddress(feature.properties.full_address ?? "");
    const canonicalStreet = (value: string) => {
      const tokens = words(value);
      const direction = /^(?:northwest|northeast|southwest|southeast|north|south|east|west)$/.test(tokens.at(-1) ?? "") ? tokens.pop() : undefined;
      // French street types precede the name. Keep an existing suffix first
      // so a real street name such as Avenue Road never becomes Road Avenue.
      const hasSuffix = /^(?:street|avenue|road|boulevard|drive|lane|crescent|way|court|place|terrace|trail|highway|parkway|circle|square|private)$/.test(tokens.at(-1) ?? "");
      if (!hasSuffix && /^(?:street|road|boulevard|avenue)$/.test(tokens[1] ?? "")) tokens.push(tokens.splice(1, 1)[0]);
      if (direction) tokens.push(direction);
      return tokens.join(" ");
    };
    if (!requestedStreet || !resultStreet || canonicalStreet(requestedStreet) !== canonicalStreet(resultStreet)) return false;
  }
  const actual = new Set(words(address ? feature.properties.full_address ?? "" : feature.properties.name ?? ""));
  return expected.every(word => actual.has(word));
}

async function searchLocation(query: string, near: string, signal?: AbortSignal, venue?: string, locality?: string): Promise<MapCoordinates | null> {
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
    (!venue || matchesVenue(venue, { geometry, properties }, locality)));
  const coordinates = feature?.geometry.coordinates;
  if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return null;
  return [coordinates[0], coordinates[1]];
}

/** Session-only query cache: Mapbox Search Box results are never persisted. */
function locationQuery(school: string, query: string, near: string, venue?: string, locality?: string) {
  return queryOptions({
    queryKey: queryKeys.events.mapLocation(school, query, venue, locality),
    queryFn: ({ signal }) => searchLocation(query, near, signal, venue, locality),
    staleTime: Infinity,
    retry: false,
  });
}

export function eventMapLocationsQuery(schoolSlug: string, school: SchoolSummary | undefined, locations: string[]) {
  const sortedLocations = [...new Set(locations)].sort();
  const queryKey = queryKeys.events.mapLocations(schoolSlug, sortedLocations);
  return queryOptions<EventMapLocations>({
    queryKey,
    retry: false,
    staleTime: query => query.state.data?.pendingCount ? 0 : Infinity,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === schoolSlug ? previous : undefined,
    queryFn: async ({ signal }): Promise<EventMapLocations> => {
      if (!school) throw new Error("School directory is unavailable");
      const client = getQueryClient();
      const context = school.city || school.name;
      const center = await client.fetchQuery(locationQuery(school.slug, `${school.name}, ${context}`, context));
      if (!center) throw new Error("School location could not be found");
      signal.throwIfAborted();
      const found: EventMapLocations = { center, locations: {}, failedCount: 0, pendingCount: 0 };
      const schoolAliases = Object.entries(controlBox.eventDiscovery.views.map_venue_aliases).find(([slug]) => slug === schoolSlug)?.[1];
      const lookups = sortedLocations.flatMap(location => {
        const parsedVenue = venueName(location);
        const venue = parsedVenue && (Object.entries(schoolAliases ?? {}).find(([name]) => name.toLocaleLowerCase() === parsedVenue.toLocaleLowerCase())?.[1] ?? parsedVenue);
        const streetAddress = getEventStreetAddress(location);
        const parts = location.split(/[,;|]|\s+\/\s+/).map(part => part.trim()).filter(Boolean);
        const streetIndex = streetAddress ? parts.findIndex(part => part.startsWith(streetAddress)) : -1;
        // Campus names and room details may sit between a street and its city.
        const locality = streetIndex >= 0 ? parts.slice(streetIndex + 1).find(part =>
          !isVirtualLocation(part) && !/\b(?:university|college|room|rm|suite|floor)\b|\d/i.test(part) && !/^[A-Z]{2,3}$/.test(part)) : undefined;
        const addressName = streetAddress && `${streetAddress}, ${locality ?? context}`;
        const queries = [
          ...(venue && venue !== streetAddress ? [locationQuery(school.slug, `${venue}, ${locality ?? context}`, center.join(","), venue, locality)] : []),
          ...(addressName ? [locationQuery(school.slug, addressName, center.join(","), addressName)] : []),
        ];
        if (!queries.length) {
          found.locations[location] = null;
          return [];
        }
        const cached = queries.map(query => client.getQueryData(query.queryKey));
        const ready = cached.find(coordinates => coordinates != null);
        if (ready || cached.every(coordinates => coordinates !== undefined)) {
          found.locations[location] = ready ?? null;
          return [];
        }
        return [{ location, queries }];
      });
      found.pendingCount = lookups.length;
      // Keep React subscribed to the existing query while venues resolve. A slow
      // venue must not hold the map, or already located events, behind a skeleton.
      const publish = () => client.setQueryData<EventMapLocations>(queryKey, { ...found, locations: { ...found.locations } });
      publish();
      let next = 0;
      // Resolve only genuinely new venues. Filtering stays on the loaded feed;
      // bounded lookups stop scheduling when this map unmounts or changes school.
      await Promise.all(Array.from({ length: Math.min(lookups.length, controlBox.eventDiscovery.views.map_search_concurrency) }, async () => {
        while (next < lookups.length) {
          signal.throwIfAborted();
          const { location, queries } = lookups[next++];
          try {
            let coordinates: MapCoordinates | null = null;
            for (const query of queries) {
              coordinates = await client.fetchQuery(query);
              signal.throwIfAborted();
              if (coordinates) break;
            }
            found.locations[location] = coordinates;
          } catch {
            signal.throwIfAborted();
            found.locations[location] = null;
            found.failedCount++;
          }
          signal.throwIfAborted();
          found.pendingCount--;
          publish();
        }
      }));
      return found;
    },
  });
}
