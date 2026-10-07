import { useCallback, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, NavigationControl, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import "./events-map.css";
import { useTranslation } from "react-i18next";
import { useEventMap } from "@/features/events/hooks/useEventMap";
import { MAPBOX_TOKEN } from "@/features/events/api/eventMap.api";
import { EventViewSurface, EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import { useEventMapMarkers } from "@/features/events/hooks/useEventMapMarkers";
import { LazyImage } from "@/shared/ui/lazy-image";
import { X } from "@/shared/ui/doodle-icons";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { controlBox } from "@/shared/config/controlBox";
import { EmptyState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import type { Event } from "@/shared/types";

export function EventsMap({ events, school, onEventClick }: { events: Event[]; school: string; onEventClick: (event: Event) => void }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { query, venues, hasPhysicalLocations, center, mappedCount, unmappedCount } = useEventMap(events, school);
  const mapRef = useRef<MapRef>(null);
  const { markers, refreshMarkers } = useEventMapMarkers(mapRef, venues);
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedEvents = venues.flatMap(venue => venue.events).filter(event => selectedIds.includes(event.id));
  const settings = controlBox.eventDiscovery.views;
  const data = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: venues.map(venue => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: venue.coordinates },
      properties: { venue: venue.coordinates.join(",") },
    })),
  }), [venues]);

  const fitVenues = useCallback(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    if (venues.length <= 1) {
      const point = venues[0]?.coordinates ?? center;
      map.jumpTo({ center: point, zoom: settings.map_initial_zoom });
      return;
    }
    const lngs = venues.map(venue => venue.coordinates[0]);
    const lats = venues.map(venue => venue.coordinates[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 64, maxZoom: settings.map_initial_zoom, duration: 0 });
  }, [center, venues, settings.map_initial_zoom]);

  if (!MAPBOX_TOKEN) return <EmptyState title={t("events.views.mapUnavailable")} description={t("events.views.mapUnavailableDescription")} />;
  if (query.isError || mapFailed) return <EmptyState title={t("events.views.mapFailed")} action={<Button variant="outline" onClick={() => { setMapFailed(false); void query.refetch(); }}>{t("common.tryAgain")}</Button>} />;
  if (query.isPending && hasPhysicalLocations) return <EventViewSkeleton />;
  if (!center) return <EmptyState title={t("events.views.noLocations")} description={t("events.views.noLocationsDescription")} />;

  return (
    <Stack gap={2}>
      <EventViewSurface aria-label={t("events.views.map")}>
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: center[0], latitude: center[1], zoom: settings.map_initial_zoom }}
          mapStyle={settings.map_style}
          onLoad={() => { fitVenues(); void refreshMarkers(); }}
          onMoveEnd={() => { void refreshMarkers(); }}
          onSourceData={event => { if (event.sourceId === "events" && event.isSourceLoaded) void refreshMarkers(); }}
          onError={() => setMapFailed(true)}
          cursor="pointer"
        >
          <NavigationControl position="top-right" />
          <Source id="events" type="geojson" data={data} cluster clusterRadius={settings.map_cluster_radius} clusterMaxZoom={settings.map_cluster_max_zoom}>
            <Layer id="event-marker-source" type="circle" paint={{ "circle-radius": 0, "circle-opacity": 0 }} />
          </Source>
          {markers.map(marker => <Marker key={marker.id} longitude={marker.coordinates[0]} latitude={marker.coordinates[1]}>
            <Button activation="click" variant="ghost" size="icon" className="event-map-marker" aria-label={marker.events.map(event => event.title).join(", ")} onPointerDown={event => event.stopPropagation()} onClick={event => {
              event.stopPropagation();
              if (marker.events.length === 1) onEventClick(marker.events[0]);
              else setSelectedIds(marker.events.map(event => event.id));
            }}>
              <LazyImage src={marker.events.find(event => event.source_image_url)?.source_image_url ?? marker.events[0].club_logo_url} alt="" width={64} height={64} loading="eager" />
              {marker.events.length > 1 ? <span className="event-map-marker-count">{marker.events.length}</span> : null}
            </Button>
          </Marker>)}
        </Map>
        {selectedEvents.length ? <aside className="event-map-sheet" aria-label={t("events.views.selectEvent")}>
          <Stack direction="horizontal" justify="between" align="center" gap={2}>
            <strong>{t("events.views.mapSummary", { count: selectedEvents.length })}</strong>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={() => setSelectedIds([])}><X /></Button>
          </Stack>
          <Stack gap={2}>
            {selectedEvents.map(event => <Button key={event.id} variant="ghost" className="event-map-row" onClick={() => onEventClick(event)}>
              <LazyImage src={event.source_image_url ?? event.club_logo_url} alt="" width={56} height={56} />
              <span className="event-map-row-copy"><strong>{event.title}</strong><span>{`${formatCardDate(event, getSchoolTimezone(school), i18n.language)}, ${formatCardTime(event, getSchoolTimezone(school), i18n.language)}`}</span><span>{event.club}</span></span>
            </Button>)}
          </Stack>
        </aside> : null}
      </EventViewSurface>
      <Stack direction="horizontal" justify="between" align="center" wrap gap={2}>
        <p className="text-sm text-muted-foreground" role="status">
          {t("events.views.mapSummary", { count: mappedCount })}
          {query.isFetching ? ` ${t("common.loading")}` : ""}
          {unmappedCount > 0 ? ` ${t("events.views.unmapped", { count: unmappedCount })}` : ""}
        </p>
        {query.data?.failedCount ? <Button size="sm" variant="outline" onClick={() => { void query.refetch(); }}>{t("common.tryAgain")}</Button> : null}
      </Stack>
    </Stack>
  );
}
