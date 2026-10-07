import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventMapLocationsQuery, MAPBOX_TOKEN, venueName, type MapCoordinates } from "@/features/events/api/eventMap.api";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";

export interface EventMapVenue {
  coordinates: MapCoordinates;
  events: Event[];
}

export function useEventMap(events: Event[], schoolSlug: string) {
  const { schoolBySlug } = useSchoolDirectory();
  const school = schoolBySlug.get(schoolSlug);
  const locations = useMemo(() => events.flatMap(event => {
    const location = event.location?.trim();
    return location && venueName(location) ? [location] : [];
  }), [events]);
  const query = useQuery({
    ...eventMapLocationsQuery(schoolSlug, school, locations),
    enabled: Boolean(MAPBOX_TOKEN && school && locations.length),
  });
  const venues = useMemo(() => {
    const byCoordinates = new Map<string, EventMapVenue>();
    for (const event of events) {
      const coordinates = query.data?.locations[event.location?.trim() ?? ""];
      if (!coordinates) continue;
      const key = coordinates.join(",");
      const venue = byCoordinates.get(key);
      if (venue) venue.events.push(event);
      else byCoordinates.set(key, { coordinates, events: [event] });
    }
    return [...byCoordinates.values()];
  }, [events, query.data]);
  const mappedCount = venues.reduce((count, venue) => count + venue.events.length, 0);
  const unmappedCount = query.isFetching ? 0 : events.length - mappedCount;
  return { query, venues, hasPhysicalLocations: locations.length > 0, center: query.data?.center, unmappedCount, mappedCount };
}
