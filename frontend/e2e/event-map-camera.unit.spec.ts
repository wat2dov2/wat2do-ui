import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { Event } from "../src/shared/types";

// Exercise the mounted component's callbacks without starting WebGL or a browser.
test("map opens on campus, flies back to campus, and keeps its camera through feed refreshes, marker selection, closing the sheet and transient tile failures", () => {
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
    if (id === "react-map-gl/maplibre") return { __esModule: true, default: "Map", Source: "Source", Layer: "Layer", Marker: "Marker", NavigationControl: "NavigationControl" };
    if (id.endsWith("useEventMap")) return { useEventMap: () => ({ venues: [{ coordinates: [1, 2], events: markerEvents }, { coordinates: [2, 3], events: [] }], center: [1, 2] }) };
    if (id.endsWith("useEventMapMarkers")) return { useEventMapMarkers: () => ({ markers: markerEvents.length ? [{ id: "venue:0", coordinates: [1, 2], events: markerEvents }] : [], refreshMarkers() {} }) };
    if (id.endsWith("useGoingEvents")) return { useGoingEvents: () => ({ data: [] }) };
    if (id.endsWith("useDarkMode")) return { useDarkMode: () => ({ isDarkMode: false }) };
    if (id.endsWith("useSchoolDirectory")) return { useSchoolDirectory: () => ({ getSchoolTimezone: () => "UTC" }) };
    if (id.endsWith("useMouseDownPress")) return { useMobileClickActivation: () => mobile };
    if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string, args?: { count: number; location: string }) => args && key.includes("cluster") ? `${args.count} events ${key.endsWith("At") ? "at" : "near"} ${args.location}` : key, i18n: { language: "en" } }) };
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_initial_zoom: 14, map_style: "https://tiles.openfreemap.org/styles/liberty", map_marker_preview_count: 3 } } } };
    if (id.endsWith("utils/event")) return { getEventImageStatus: () => "default" };
    if (id.endsWith("utils/date")) return { formatCardDate: () => "Today", formatCardTime: () => "6 PM", isEventHappeningNow: () => false };
    return primitive;
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.EventsMap({ events: markerEvents, school: "uwaterloo", onEventClick() { openedEvents++; } }); };
  const find = (node: Node, predicate: (node: Node) => boolean): Node | undefined => {
    if (!node?.props) return undefined;
    if (predicate(node)) return node;
    if (typeof node.type === "function") return find(node.type(node.props), predicate);
    return [node.props.children].flat(2).flatMap(child => child ? [find(child, predicate)] : []).find(Boolean);
  };
  let tree = render();
  let map = find(tree, node => node.type === "Map")!;
  expect(map.props.mapStyle).toBe("https://tiles.openfreemap.org/styles/liberty");
  expect(map.props.cooperativeGestures).not.toBe(true);
  // Credits are compact only on narrow maps, not MapLibre's always-compact default.
  expect(map.props.attributionControl).toEqual({});
  // The map can report a missing source tile before its first load. That must
  // not unmount Waterloo's canvas while other source tiles are still loading.
  (map.props.onError as (event: object) => void)({ target: {}, error: { message: "Failed to fetch", url: "https://tiles.openfreemap.org/planet/20261008_001001_pt/14/4526/5985.pbf" } });
  expect(find(render(), node => node.type === "Map")).toBeDefined();
  // A style that cannot load before the first render is a whole-map failure.
  (map.props.onError as (event: object) => void)({ target: {}, error: { message: "Failed to fetch", url: "https://tiles.openfreemap.org/styles/liberty" } });
  tree = render();
  expect(find(tree, node => node.type === "Map")).toBeUndefined();
  ((find(tree, node => node.type === "EmptyState")!.props.action as Node).props.onClick as () => void)();
  expect(find(render(), node => node.type === "Map")).toBeDefined();
  // A genuine initialization failure still exposes the existing retry action.
  (map.props.onError as (event: object) => void)({ target: null, error: new Error("Failed to initialize WebGL") });
  tree = render();
  expect(find(tree, node => node.type === "Map")).toBeUndefined();
  const failed = find(tree, node => node.type === "EmptyState")!;
  expect(failed.props.title).toBe("events.views.mapFailed");
  ((failed.props.action as Node).props.onClick as () => void)();
  tree = render();
  map = find(tree, node => node.type === "Map")!;
  expect(map.props.initialViewState).toEqual({ longitude: 1, latitude: 2, zoom: 14 });
  const flights: unknown[] = [];
  refs[0].current = { fitBounds() { fits++; }, jumpTo() { fits++; }, flyTo(options: unknown) { fits++; flights.push(options); } };
  // The map opens on the campus centre; loading never refits it to the events.
  // Phone-width credits start behind their ⓘ button instead of covering Back to campus.
  const credits = new Set(["maplibregl-ctrl-attrib", "maplibregl-compact", "maplibregl-compact-show"]);
  const container = { querySelector: (selector: string) => selector === ".maplibregl-compact-show" && credits.has("maplibregl-compact-show") ? { classList: { remove: (name: string) => credits.delete(name) } } : null };
  (map.props.onLoad as (event: object) => void)({ target: { getContainer: () => container } });
  expect([...credits]).toEqual(["maplibregl-ctrl-attrib", "maplibregl-compact"]);
  expect(fits).toBe(0);
  const home = find(tree, node => node.props.className === "event-map-home")!;
  expect([home.props.children].flat()).toContain("events.views.backToCampus");
  (home.props.onClick as () => void)();
  expect(flights).toEqual([{ center: [1, 2], zoom: 14 }]);
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
    getSource: () => ({ getClusterLeaves: async (_id: number, count: number) => {
      leafReads++; expect(count).toBe(2); return [{ properties: { venue: "1,2" } }, { properties: { venue: "2,3" } }];
    } }),
  } };
  const hook = exports.useEventMapMarkers(mapRef, venues);
  await hook.refreshMarkers();
  expect(leafReads).toBe(1);
  expect(markers).toHaveLength(1);
  expect(markers[0].events.map(event => event.id)).toEqual([1, 2, 3]);
  // The map can still expose the previous source while newly located venues
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

test("map pins each event at the coordinates stored with it in the feed", () => {
  const filename = new URL("../src/features/events/hooks/useEventMap.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  // The map places each map location's stored coordinates, never the display location.
  const listing = { id: 1, location: "SLC 3223", map_location: "Student Life Centre", map_coordinates: [1, 2] } as Event;
  const second = { id: 2, location: "DC 1350", map_location: "Davis Centre", map_coordinates: [2, 3] } as Event;
  const sameBuilding = { id: 3, location: "SLC Great Hall", map_location: "Student Life Centre", map_coordinates: [1, 2] } as Event;
  const online = { id: 4, location: "Zoom", map_location: null, map_coordinates: null } as Event;
  const unlocated = { id: 5, location: "The Lounge", map_location: "The Lounge", map_coordinates: null } as Event;
  const exports = {} as { useEventMap: (events: Event[], school: string) => { venues: { coordinates: number[]; events: unknown[] }[]; center?: number[] } };
  runInNewContext(source, { exports, require: (id: string) => {
    if (id === "react") return { useMemo: (fn: () => unknown) => fn() };
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_campus_centers: { uwaterloo: [5, 6] } } } } };
    throw new Error(`The map must not load anything else: ${id}`);
  } });
  const { venues, center } = exports.useEventMap([listing, second, sameBuilding, online, unlocated], "uwaterloo");
  expect(center).toEqual([5, 6]);
  expect(venues).toEqual([
    { coordinates: [1, 2], events: [listing, sameBuilding] },
    { coordinates: [2, 3], events: [second] },
  ]);
  expect(exports.useEventMap([second], "uwaterloo").venues).toEqual([{ coordinates: [2, 3], events: [second] }]);
  expect(exports.useEventMap([listing], "unknown").center).toBeUndefined();
});
