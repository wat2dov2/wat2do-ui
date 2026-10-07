import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { Event } from "../src/shared/types";

// Exercise the mounted component's callbacks without starting WebGL or a browser.
test("map camera survives feed refreshes, marker selection, closing the sheet and transient tile failures", () => {
  const filename = new URL("../src/features/events/components/EventsMap.tsx", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(filename);
  const listing = { id: 1, title: "Cooking", club: "Cooking club", location: "Student Life Centre", occurrences: [] } as unknown as Event;
  const secondListing = { ...listing, id: 2, title: "Dinner" };
  let markerEvents = [listing, secondListing];
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let fits = 0;
  let openedEvents = 0;
  let retries = 0;
  let mobile = false;
  const exports = {} as { EventsMap: (props: object) => Node };
  interface Node { type: unknown; props: { children?: Node | Node[]; [key: string]: unknown } }
  const primitive = new Proxy({}, { get: (_, key) => String(key) });
  runInNewContext(source, { exports, require: (id: string) => {
    if (id.endsWith(".css")) return {};
    if (id === "react") return {
      useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
      useRef: (initial: unknown) => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
      useState: (initial: unknown) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
      useEffect: (fn: () => void) => fn(),
    };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-map-gl/mapbox") return { __esModule: true, default: "Map", Source: "Source", Layer: "Layer", Marker: "Marker", NavigationControl: "NavigationControl" };
    if (id.endsWith("useEventMap")) return { useEventMap: () => ({ query: { data: {}, isPending: false, refetch() { retries++; } }, venues: [{ coordinates: [1, 2], events: markerEvents }, { coordinates: [2, 3], events: [] }], center: [1, 2], mappedCount: markerEvents.length, unmappedCount: 0 }) };
    if (id.endsWith("useEventMapMarkers")) return { useEventMapMarkers: () => ({ markers: markerEvents.length ? [{ id: "venue:0", coordinates: [1, 2], events: markerEvents }] : [], refreshMarkers() {} }) };
    if (id.endsWith("useGoingEvents")) return { useGoingEvents: () => ({ data: [] }) };
    if (id.endsWith("eventMap.api")) return { MAPBOX_TOKEN: "test" };
    if (id.endsWith("useDarkMode")) return { useDarkMode: () => ({ isDarkMode: false }) };
    if (id.endsWith("useSchoolDirectory")) return { useSchoolDirectory: () => ({ getSchoolTimezone: () => "UTC" }) };
    if (id.endsWith("useMouseDownPress")) return { useMobileClickActivation: () => mobile };
    if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string, args?: { count: number; location: string }) => args && key.includes("cluster") ? `${args.count} events ${key.endsWith("At") ? "at" : "near"} ${args.location}` : key, i18n: { language: "en" } }) };
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_initial_zoom: 14, map_style: "mapbox://styles/mapbox/streets-v12", map_marker_preview_count: 3 } } } };
    if (id.endsWith("utils/event")) return { getEventImageStatus: () => "default" };
    if (id.endsWith("utils/date")) return { formatCardDate: () => "Today", formatCardTime: () => "6 PM" };
    return primitive;
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.EventsMap({ events: markerEvents, allEvents: [listing, secondListing], school: "uwaterloo", onEventClick() { openedEvents++; } }); };
  const find = (node: Node, predicate: (node: Node) => boolean): Node | undefined => {
    if (!node?.props) return undefined;
    if (predicate(node)) return node;
    if (typeof node.type === "function") return find(node.type(node.props), predicate);
    return [node.props.children].flat(2).flatMap(child => child ? [find(child, predicate)] : []).find(Boolean);
  };
  let tree = render();
  let map = find(tree, node => node.type === "Map")!;
  expect(map.props.mapStyle).toBe("mapbox://styles/mapbox/streets-v12");
  expect(map.props.cooperativeGestures).not.toBe(true);
  // Mapbox can report a missing source tile before its first load. That must
  // not unmount Waterloo's canvas while other source tiles are still loading.
  (map.props.onError as (event: object) => void)({ target: {}, error: { message: "Failed to fetch", url: "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/14/4526/5985.vector.pbf" } });
  expect(find(render(), node => node.type === "Map")).toBeDefined();
  // A genuine initialization failure still exposes the existing retry action.
  (map.props.onError as (event: object) => void)({ target: null, error: new Error("Failed to initialize WebGL") });
  tree = render();
  expect(find(tree, node => node.type === "Map")).toBeUndefined();
  const failed = find(tree, node => node.type === "EmptyState")!;
  expect(failed.props.title).toBe("events.views.mapFailed");
  ((failed.props.action as Node).props.onClick as () => void)();
  expect(retries).toBe(1);
  tree = render();
  map = find(tree, node => node.type === "Map")!;
  refs[0].current = { fitBounds() { fits++; }, jumpTo() { fits++; } };
  (map.props.onLoad as () => void)();
  expect(fits).toBe(1);
  // Individual resource failures after a successful load retain the canvas
  // and its existing camera instead of switching to a whole-map failure.
  (map.props.onError as (event: object) => void)({ target: {}, error: { message: "Failed to fetch" } });
  tree = render();
  expect(find(tree, node => node.type === "Map")).toBeDefined();
  expect(find(tree, node => node.type === "EmptyState")).toBeUndefined();
  expect(fits).toBe(1);
  const marker = find(tree, node => node.props.className === "event-map-marker")!;
  expect(marker.props.activation).toBe("click");
  expect(find(marker, node => node.type === "LazyImage")?.props.width).toBe(64);
  let stopped = false;
  (marker.props.onClick as (event: object) => void)({ stopPropagation() { stopped = true; } });
  expect(stopped).toBe(true);
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeDefined();
  expect(find(tree, node => node.type === "aside")?.props["aria-label"]).toBe("2 events at Student Life Centre");
  (find(tree, node => node.props.className === "event-map-row")!.props.onClick as () => void)();
  expect(openedEvents).toBe(1);
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeDefined();
  expect(fits).toBe(1);
  (find(tree, node => node.props["aria-label"] === "common.close")!.props.onClick as () => void)();
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeUndefined();
  expect(fits).toBe(1);
  markerEvents = [listing, { ...secondListing, location: "Davis Centre" }];
  (find(render(), node => node.props.className === "event-map-marker")!.props.onClick as (event: object) => void)({ stopPropagation() {} });
  expect(find(render(), node => node.type === "aside")?.props["aria-label"]).toBe("2 events near Student Life Centre");
  mobile = true;
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeUndefined();
  let drawer = find(tree, node => node.type === "Drawer")!;
  expect(drawer.props.open).toBe(true);
  expect(find(drawer, node => node.type === "DrawerTitle")?.props.children).toBe("2 events near Student Life Centre");
  (find(drawer, node => node.props.className === "event-map-row")!.props.onClick as () => void)();
  expect(openedEvents).toBe(2);
  expect(find(render(), node => node.type === "Drawer")?.props.open).toBe(false);
  (find(render(), node => node.props.className === "event-map-marker")!.props.onClick as (event: object) => void)({ stopPropagation() {} });
  drawer = find(render(), node => node.type === "Drawer")!;
  expect(drawer.props.open).toBe(true);
  (drawer.props.onOpenChange as (open: boolean) => void)(false);
  expect(find(render(), node => node.type === "Drawer")?.props.open).toBe(false);
  mobile = false;
  markerEvents = [listing];
  tree = render();
  (find(tree, node => node.props.className === "event-map-marker")!.props.onClick as (event: object) => void)({ stopPropagation() {} });
  expect(openedEvents).toBe(3);
  expect(find(render(), node => node.type === "aside")).toBeUndefined();
  expect(fits).toBe(1);
  markerEvents = [];
  tree = render();
  expect(find(tree, node => node.type === "Map")).toBeDefined();
  expect(find(tree, node => node.type === "Marker")).toBeUndefined();
  expect(fits).toBe(1);
});

test("visible thumbnail clusters contain all their events and deduplicate tile copies", async () => {
  const filename = new URL("../src/features/events/hooks/useEventMapMarkers.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let markers: { events: Event[] }[] = [];
  let leafReads = 0;
  const cluster = { geometry: { type: "Point", coordinates: [1, 2] }, properties: { cluster: true, cluster_id: 7, point_count: 2 } };
  const venues = [{ coordinates: [1, 2], events: [{ id: 1 }, { id: 2 }] }, { coordinates: [2, 3], events: [{ id: 3 }] }];
  const exports = {} as { useEventMapMarkers: (ref: object, venues: unknown[]) => { refreshMarkers: () => Promise<void> } };
  runInNewContext(source, { exports, require: (id: string) => {
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_marker_viewport_padding_px: 80 } } } };
    return {
      useState: () => [markers, (value: typeof markers) => { markers = value; }],
      useRef: () => ({ current: 0 }), useEffect: () => {}, useCallback: (fn: unknown) => fn,
    };
  } });
  const mapRef = { current: {
    isSourceLoaded: () => true, getBounds: () => ({ contains: () => true }),
    getCanvas: () => ({ clientWidth: 600, clientHeight: 400 }), project: () => ({ x: 300, y: 200 }),
    querySourceFeatures: () => [cluster, cluster],
    getSource: () => ({ getClusterLeaves: (_id: number, count: number, _offset: number, callback: (error: null, leaves: object[]) => void) => {
      leafReads++; expect(count).toBe(2); callback(null, [{ properties: { venue: "1,2" } }, { properties: { venue: "2,3" } }]);
    } }),
  } };
  const hook = exports.useEventMapMarkers(mapRef, venues);
  await hook.refreshMarkers();
  expect(leafReads).toBe(1);
  expect(markers).toHaveLength(1);
  expect(markers[0].events.map(event => event.id)).toEqual([1, 2, 3]);
  // Mapbox can still expose the previous source while newly located venues
  // change their array order. Stable venue keys keep images/clicks correct.
  await exports.useEventMapMarkers(mapRef, [...venues].reverse()).refreshMarkers();
  expect(markers[0].events.map(event => event.id)).toEqual([1, 2, 3]);
});

test("map keeps overlapping thumbnail stacks near every viewport edge", async () => {
  const filename = new URL("../src/features/events/hooks/useEventMapMarkers.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let markers: { events: Event[] }[] = [];
  const venues = [
    [-40, 200], [640, 200], [300, -40], [300, 440],
    [-81, 200], [681, 200], [300, -81], [300, 481],
  ].map((coordinates, index) => ({ coordinates, events: [{ id: index + 1 }] }));
  const exports = {} as { useEventMapMarkers: (ref: object, venues: unknown[]) => { refreshMarkers: () => Promise<void> } };
  runInNewContext(source, { exports, require: (id: string) => {
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_marker_viewport_padding_px: 80 } } } };
    return {
      useState: () => [markers, (value: typeof markers) => { markers = value; }],
      useRef: () => ({ current: 0 }), useEffect: () => {}, useCallback: (fn: unknown) => fn,
    };
  } });
  const mapRef = { current: {
    isSourceLoaded: () => true, getSource: () => ({}),
    getBounds: () => ({ contains: () => false }),
    getCanvas: () => ({ clientWidth: 600, clientHeight: 400 }),
    project: ([x, y]: number[]) => ({ x, y }),
    querySourceFeatures: () => venues.map(venue => ({
      geometry: { type: "Point", coordinates: venue.coordinates }, properties: { venue: venue.coordinates.join(",") },
    })),
  } };
  await exports.useEventMapMarkers(mapRef, venues).refreshMarkers();
  expect(markers.flatMap(marker => marker.events.map(event => event.id))).toEqual([1, 2, 3, 4]);
});

test("map filters the loaded events without changing its location query", () => {
  const filename = new URL("../src/features/events/hooks/useEventMap.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  const listing = { id: 1, location: "Student Life Centre" } as Event;
  const second = { id: 2, location: "Davis Centre" } as Event;
  const allEvents = [listing, second];
  const options: { locations: string[]; enabled: boolean }[] = [];
  const exports = {} as { useEventMap: (events: Event[], allEvents: Event[], school: string) => { mappedCount: number; venues: unknown[]; center: number[] } };
  runInNewContext(source, { exports, require: (id: string) => {
    if (id === "react") return { useMemo: (fn: () => unknown) => fn() };
    if (id === "@tanstack/react-query") return { useQuery: (query: typeof options[number]) => {
      options.push(query);
      return { data: { center: [1, 2], locations: { "Student Life Centre": [1, 2], "Davis Centre": [2, 3] } }, isFetching: false };
    } };
    if (id.endsWith("eventMap.api")) return {
      MAPBOX_TOKEN: "test", venueName: (location: string) => location,
      eventMapLocationsQuery: (_school: string, _record: unknown, locations: string[]) => ({ locations }),
    };
    return { useSchoolDirectory: () => ({ schoolBySlug: new Map([["uwaterloo", { slug: "uwaterloo" }]]) }) };
  } });
  expect(exports.useEventMap([listing], allEvents, "uwaterloo").mappedCount).toBe(1);
  expect(exports.useEventMap([second], allEvents, "uwaterloo").mappedCount).toBe(1);
  const empty = exports.useEventMap([], allEvents, "uwaterloo");
  expect(empty.mappedCount).toBe(0);
  expect(empty.center).toEqual([1, 2]);
  expect(options.map(query => query.locations)).toEqual([
    ["Student Life Centre", "Davis Centre"], ["Student Life Centre", "Davis Centre"], ["Student Life Centre", "Davis Centre"],
  ]);
  expect(options.every(query => query.enabled)).toBe(true);
});
