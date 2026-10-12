import { useMemo } from "react";
import { controlBox } from "@/shared/config/controlBox";
import type { Event } from "@/shared/types";

export type MapCoordinates = [longitude: number, latitude: number];

export interface EventMapVenue {
  coordinates: MapCoordinates;
  events: Event[];
}

/** Group events by the coordinates the feed stores with each one; the original location is display text. */
export function useEventMap(events: Event[], schoolSlug: string) {
  // Every campus center is fixed in the event discovery control box.
  const configured = (controlBox.eventDiscovery.views.map_campus_centers as Record<string, number[] | undefined>)[schoolSlug];
  const center: MapCoordinates | undefined = configured && [configured[0], configured[1]];
  const venues = useMemo(() => {
    const byCoordinates = new Map<string, EventMapVenue>();
    for (const event of events) {
      const coordinates = event.map_coordinates;
      if (!coordinates) continue;
      const key = coordinates.join(",");
      const venue = byCoordinates.get(key);
      if (venue) venue.events.push(event);
      else byCoordinates.set(key, { coordinates: [coordinates[0], coordinates[1]], events: [event] });
    }
    return [...byCoordinates.values()];
  }, [events]);
  return { venues, center };
}
