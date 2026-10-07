import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource } from "mapbox-gl";
import type { MapRef } from "react-map-gl/mapbox";
import type { EventMapVenue } from "@/features/events/hooks/useEventMap";
import type { Event } from "@/shared/types";

interface EventMapMarker {
  id: string;
  coordinates: [number, number];
  events: Event[];
}

/** Render only visible Mapbox clusters, retaining the source's single clustering path. */
export function useEventMapMarkers(mapRef: React.RefObject<MapRef | null>, venues: EventMapVenue[]) {
  const [markers, setMarkers] = useState<EventMapMarker[]>([]);
  const generation = useRef(0);
  const refreshMarkers = useCallback(async () => {
    const map = mapRef.current;
    const source = map?.getSource("events") as GeoJSONSource | undefined;
    if (!map || !source || !map.isSourceLoaded("events")) return;
    const revision = ++generation.current;
    const seen = new Set<string>();
    const features = map.querySourceFeatures("events").filter(feature => {
      if (feature.geometry.type !== "Point") return false;
      const id = feature.properties?.cluster ? `cluster:${feature.properties.cluster_id}` : `venue:${feature.properties?.index}`;
      if (seen.has(id) || !map.getBounds()?.contains(feature.geometry.coordinates as [number, number])) return false;
      seen.add(id);
      return true;
    });
    const next = await Promise.all(features.map(async feature => {
      const properties = feature.properties ?? {};
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const indices: number[] = properties.cluster ? await new Promise<number[]>(resolve => {
        source.getClusterLeaves(properties.cluster_id, properties.point_count, 0, (error, leaves) => {
          resolve(error ? [] : (leaves ?? []).map(leaf => Number(leaf.properties?.index)));
        });
      }) : [Number(properties.index)];
      return {
        id: properties.cluster ? `cluster:${properties.cluster_id}` : `venue:${properties.index}`,
        coordinates,
        events: indices.flatMap(index => venues[index]?.events ?? []),
      };
    }));
    if (revision === generation.current) setMarkers(next.filter(marker => marker.events.length));
  }, [mapRef, venues]);
  useEffect(() => {
    void refreshMarkers();
    return () => { generation.current += 1; };
  }, [refreshMarkers]);
  return { markers, refreshMarkers };
}
