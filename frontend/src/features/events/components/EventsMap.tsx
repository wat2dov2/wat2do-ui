import { useCallback, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, NavigationControl, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import "./events-map.css";
import { useTranslation } from "react-i18next";
import { useEventMap } from "@/features/events/hooks/useEventMap";
import { MAPBOX_TOKEN } from "@/features/events/api/eventMap.api";
import { EventViewSurface, EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import { useEventMapMarkers } from "@/features/events/hooks/useEventMapMarkers";
import { useGoingEvents } from "@/features/events/hooks/useGoingEvents";
import { LazyImage } from "@/shared/ui/lazy-image";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { X } from "@/shared/ui/doodle-icons";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { controlBox } from "@/shared/config/controlBox";
import { EmptyState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/shared/ui/drawer";
import { DrawerBody } from "@/shared/layout/drawer-body";
import { useMobileClickActivation } from "@/shared/hooks/useMouseDownPress";
import { getEventImageStatus } from "@/shared/utils/event";
import type { Event } from "@/shared/types";

function EventMapPoster({ event, isGoing }: { event: Event; isGoing: boolean }) {
  return <span className="event-map-poster" data-status={getEventImageStatus(event, isGoing)} data-featured={event.featured || undefined}>
    <LazyImage src={event.source_image_url ?? event.club_logo_url} alt="" width={64} height={64} loading="eager" />
  </span>;
}

function EventMapMarker({ events, goingIds, onSelect }: { events: Event[]; goingIds: ReadonlySet<number>; onSelect: () => void }) {
  return <Button activation="click" variant="ghost" size="icon" className="event-map-marker" aria-label={events.map(event => event.title).join(", ")} onPointerDown={event => event.stopPropagation()} onClick={event => {
    event.stopPropagation();
    onSelect();
  }}>
    <span className="event-map-poster-stack" data-count={Math.min(events.length, controlBox.eventDiscovery.views.map_marker_preview_count)}>
      {events.slice(0, controlBox.eventDiscovery.views.map_marker_preview_count).map(event => <EventMapPoster key={event.id} event={event} isGoing={goingIds.has(event.id)} />)}
    </span>
    {events.length > 1 ? <span className="event-map-marker-count">{events.length}</span> : null}
  </Button>;
}

function EventMapSelection({ events, goingIds, timezone, language, onEventClick }: { events: Event[]; goingIds: ReadonlySet<number>; timezone: string; language: string; onEventClick: (event: Event) => void }) {
  return <Stack gap={2}>
    {events.map(event => <Button key={event.id} variant="ghost" className="event-map-row" onClick={() => onEventClick(event)}>
      <EventMapPoster event={event} isGoing={goingIds.has(event.id)} />
      <span className="event-map-row-copy">
        <strong>{event.title}</strong>
        <span>{`${formatCardDate(event, timezone, language)}, ${formatCardTime(event, timezone, language)}`}</span>
        <span className="event-map-row-club"><AvatarStack size="sm" avatars={[
          { name: event.club, src: event.club_logo_url ?? "" },
          ...(event.cohosts ?? []).map(club => ({ name: club.club_name, src: club.logo_url ?? "" })),
        ]} /><span>{event.club}</span></span>
      </span>
    </Button>)}
  </Stack>;
}

export function EventsMap({ events, allEvents, school, onEventClick }: { events: Event[]; allEvents: Event[]; school: string; onEventClick: (event: Event) => void }) {
  const { t, i18n } = useTranslation();
  const mobile = useMobileClickActivation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { query, venues, center, mappedCount, unmappedCount } = useEventMap(events, allEvents, school);
  const { data: goingSelections = [] } = useGoingEvents();
  const goingIds = useMemo(() => new Set(goingSelections.map(selection => selection.event_id)), [goingSelections]);
  const mapRef = useRef<MapRef>(null);
  const mapLoaded = useRef(false);
  const { markers, refreshMarkers } = useEventMapMarkers(mapRef, venues);
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedEvents = venues.flatMap(venue => venue.events).filter(event => selectedIds.includes(event.id));
  const selectedLocation = selectedEvents[0]?.location?.trim() ?? "";
  const selectedHeading = t(selectedEvents.every(event => event.location?.trim().toLocaleLowerCase() === selectedLocation.toLocaleLowerCase()) ? "events.views.clusterAt" : "events.views.clusterNear", { count: selectedEvents.length, location: selectedLocation });
  const selection = selectedEvents.length ? <EventMapSelection events={selectedEvents} goingIds={goingIds} timezone={getSchoolTimezone(school)} language={i18n.language} onEventClick={event => {
    if (mobile) setSelectedIds([]);
    onEventClick(event);
  }} /> : null;
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
  if ((query.isError && !center) || mapFailed) return <EmptyState title={t("events.views.mapFailed")} action={<Button variant="outline" onClick={() => { setMapFailed(false); void query.refetch(); }}>{t("common.tryAgain")}</Button>} />;
  if (query.isPending && !center) return <EventViewSkeleton variant="map" />;
  if (!center) return <EmptyState title={t("events.views.noLocations")} description={t("events.views.noLocationsDescription")} />;

  return (
    <Stack gap={2} grow>
      <EventViewSurface variant="map" aria-label={t("events.views.map")}>
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: center[0], latitude: center[1], zoom: settings.map_initial_zoom }}
          mapStyle={settings.map_style}
          onLoad={() => { mapLoaded.current = true; fitVenues(); void refreshMarkers(); }}
          onMoveEnd={() => { void refreshMarkers(); }}
          onResize={() => { void refreshMarkers(); }}
          onSourceData={event => { if (event.sourceId === "events" && event.isSourceLoaded) void refreshMarkers(); }}
          onError={event => {
            // Source/tile errors may arrive before load. Keep that map alive so
            // Mapbox can finish rendering; only initialization/style failures
            // can replace the entire viewport with its retry state.
            const error = event.error as { url?: string };
            if (!mapLoaded.current && (event.target === null || error.url?.includes("/styles/v1/"))) setMapFailed(true);
          }}
          cursor="pointer"
        >
          <NavigationControl position="top-right" />
          <Source id="events" type="geojson" data={data} cluster clusterRadius={settings.map_cluster_radius} clusterMaxZoom={settings.map_cluster_max_zoom}>
            <Layer id="event-marker-source" type="circle" paint={{ "circle-radius": 0, "circle-opacity": 0 }} />
          </Source>
          {markers.map(marker => <Marker key={marker.id} longitude={marker.coordinates[0]} latitude={marker.coordinates[1]}>
            <EventMapMarker events={marker.events} goingIds={goingIds} onSelect={() => {
              if (marker.events.length === 1) onEventClick(marker.events[0]);
              else setSelectedIds(marker.events.map(event => event.id));
            }} />
          </Marker>)}
        </Map>
        {selectedEvents.length && !mobile ? <aside className="event-map-sheet" aria-label={selectedHeading}>
          <Stack direction="horizontal" justify="between" align="center" gap={2}>
            <strong>{selectedHeading}</strong>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={() => setSelectedIds([])}><X /></Button>
          </Stack>
          {selection}
        </aside> : null}
      </EventViewSurface>
      {mobile ? <Drawer open={selectedEvents.length > 0} onOpenChange={open => { if (!open) setSelectedIds([]); }}>
        <DrawerContent aria-describedby={undefined}>
          <DrawerHeader>
            <Stack direction="horizontal" justify="between" align="center" gap={2}>
              <DrawerTitle>{selectedHeading}</DrawerTitle>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={() => setSelectedIds([])}><X /></Button>
            </Stack>
          </DrawerHeader>
          <DrawerBody>{selection}</DrawerBody>
        </DrawerContent>
      </Drawer> : null}
      <Stack direction="horizontal" justify="between" align="center" wrap gap={2}>
        <p className="text-sm text-muted-foreground" role="status">
          {t("events.views.mapSummary", { count: mappedCount })}
          {query.isFetching ? ` ${t("common.loading")}` : ""}
          {unmappedCount > 0 ? ` ${t("events.views.unmapped", { count: unmappedCount })}` : ""}
        </p>
        {query.data?.failedCount || query.isError ? <Button size="sm" variant="outline" onClick={() => { void query.refetch(); }}>{t("common.tryAgain")}</Button> : null}
      </Stack>
    </Stack>
  );
}
