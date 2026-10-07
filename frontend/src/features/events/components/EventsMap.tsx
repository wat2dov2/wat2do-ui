import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Popup, NavigationControl, type MapRef, type MapMouseEvent } from "react-map-gl/mapbox";
import type { GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./events-map.css";
import { useTranslation } from "react-i18next";
import { useEventMap } from "@/features/events/hooks/useEventMap";
import { MAPBOX_TOKEN } from "@/features/events/api/eventMap.api";
import { EventViewSurface, EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { controlBox } from "@/shared/config/controlBox";
import { EmptyState } from "@/shared/feedback";
import { Stack } from "@/shared/layout/stack";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Button } from "@/shared/ui/button";
import type { Event } from "@/shared/types";

// Mapbox paints require sRGB colors. Browser theme tokens use OKLCH, so let
// the canvas color engine convert the computed token without duplicating a palette.
function mapPaintColors(element: HTMLElement) {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Map color conversion is unavailable");
  const rgb = (color: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${red},${green},${blue},${alpha / 255})`;
  };
  return { primary: rgb(style.backgroundColor), foreground: rgb(style.color), border: rgb(style.borderColor) };
}

const CLUSTERS = "event-clusters";
const VENUES = "event-venues";

export function EventsMap({ events, school, onEventClick }: { events: Event[]; school: string; onEventClick: (event: Event) => void }) {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();
  const { query, venues, hasPhysicalLocations, center, mappedCount, unmappedCount } = useEventMap(events, school);
  const mapRef = useRef<MapRef>(null);
  const themeRef = useRef<HTMLSpanElement>(null);
  const [colors, setColors] = useState<{ primary: string; foreground: string; border: string } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedCoordinates, setSelectedCoordinates] = useState<string | null>(null);
  const selectedVenue = venues.find(venue => venue.coordinates.join(",") === selectedCoordinates);
  const settings = controlBox.eventDiscovery.views;
  const data = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: venues.map((venue, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: venue.coordinates },
      properties: { index, count: venue.events.length },
    })),
  }), [venues]);

  useEffect(() => {
    if (!themeRef.current) return;
    setColors(mapPaintColors(themeRef.current));
  }, [isDarkMode, query.isPending]);

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

  useEffect(() => {
    if (mapReady) fitVenues();
  }, [fitVenues, mapReady]);

  const selectFeature = (event: MapMouseEvent) => {
    const feature = event.features?.[0];
    const map = mapRef.current;
    if (!feature || !map) return;
    if (feature.layer?.id === CLUSTERS && feature.geometry.type === "Point") {
      const coordinates = feature.geometry.coordinates as [number, number];
      const source = map.getSource("events") as GeoJSONSource;
      source.getClusterExpansionZoom(Number(feature.properties?.cluster_id), (error, zoom) => {
        if (!error && zoom != null) map.easeTo({ center: coordinates, zoom });
      });
      return;
    }
    const index = feature.properties?.index;
    const venue = typeof index === "number" ? venues[index] : undefined;
    if (!venue) return;
    if (venue.events.length === 1) onEventClick(venue.events[0]);
    else setSelectedCoordinates(venue.coordinates.join(","));
  };

  if (!MAPBOX_TOKEN) return <EmptyState title={t("events.views.mapUnavailable")} description={t("events.views.mapUnavailableDescription")} />;
  if (query.isError || mapFailed) return <EmptyState title={t("events.views.mapFailed")} action={<Button variant="outline" onClick={() => { setMapFailed(false); void query.refetch(); }}>{t("common.tryAgain")}</Button>} />;
  if (query.isPending && hasPhysicalLocations) return <EventViewSkeleton />;
  if (!center) return <EmptyState title={t("events.views.noLocations")} description={t("events.views.noLocationsDescription")} />;

  return (
    <Stack gap={2}>
      <EventViewSurface aria-label={t("events.views.map")}>
        <span ref={themeRef} aria-hidden="true" className="invisible absolute border border-border bg-primary text-primary-foreground" />
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: center[0], latitude: center[1], zoom: settings.map_initial_zoom }}
          mapStyle={isDarkMode ? settings.map_dark_style : settings.map_light_style}
          interactiveLayerIds={colors ? [CLUSTERS, VENUES] : []}
          onClick={selectFeature}
          onLoad={() => setMapReady(true)}
          onError={() => setMapFailed(true)}
          cursor="pointer"
          cooperativeGestures
        >
          <NavigationControl position="top-right" />
          {colors ? <Source id="events" type="geojson" data={data} cluster clusterProperties={{ event_count: ["+", ["get", "count"]] }} clusterRadius={settings.map_cluster_radius} clusterMaxZoom={settings.map_cluster_max_zoom}>
            <Layer id={CLUSTERS} type="circle" filter={["has", "point_count"]} paint={{ "circle-color": colors.primary, "circle-stroke-color": colors.border, "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 20, 10, 25, 30, 30] }} />
            <Layer id="event-cluster-count" type="symbol" filter={["has", "point_count"]} layout={{ "text-field": ["to-string", ["get", "event_count"]], "text-size": 12 }} paint={{ "text-color": colors.foreground }} />
            <Layer id={VENUES} type="circle" filter={["!", ["has", "point_count"]]} paint={{ "circle-color": colors.primary, "circle-stroke-color": colors.border, "circle-stroke-width": 2, "circle-radius": 14 }} />
            <Layer id="event-venue-count" type="symbol" filter={["!", ["has", "point_count"]]} layout={{ "text-field": ["to-string", ["get", "count"]], "text-size": 12 }} paint={{ "text-color": colors.foreground }} />
          </Source> : null}
          {selectedVenue ? <Popup longitude={selectedVenue.coordinates[0]} latitude={selectedVenue.coordinates[1]} closeOnClick={false} onClose={() => setSelectedCoordinates(null)} maxWidth="320px">
            <Stack gap={2}>
              {selectedVenue.events.map(event => <Button key={event.id} variant="link" size="inline" onClick={() => { setSelectedCoordinates(null); onEventClick(event); }}>{event.title}</Button>)}
            </Stack>
          </Popup> : null}
        </Map>
      </EventViewSurface>
      <Stack direction="horizontal" justify="between" align="center" wrap gap={2}>
      <p className="text-sm text-muted-foreground" role="status">
        {t("events.views.mapSummary", { count: mappedCount })}
        {unmappedCount > 0 ? ` ${t("events.views.unmapped", { count: unmappedCount })}` : ""}
      </p>
      {query.data?.failedCount ? <Button size="sm" variant="outline" onClick={() => { void query.refetch(); }}>{t("common.tryAgain")}</Button> : null}
      {mappedCount > 0 ? <Select value="" onValueChange={value => {
        const event = venues.flatMap(venue => venue.events).find(item => String(item.id) === value);
        if (event) onEventClick(event);
      }}>
        <SelectTrigger size="sm" aria-label={t("events.views.selectEvent")}>
          <SelectValue placeholder={t("events.views.selectEvent")} />
        </SelectTrigger>
        <SelectContent>
          {venues.flatMap(venue => venue.events).map(event => <SelectItem key={event.id} value={String(event.id)}>{event.title}</SelectItem>)}
        </SelectContent>
      </Select> : null}
      </Stack>
    </Stack>
  );
}
