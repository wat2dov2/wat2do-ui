import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { Event } from "../src/shared/types";

// Exercise the mounted component's callbacks without starting WebGL or a browser.
test("map camera survives feed refreshes, marker selection and closing the sheet", () => {
  const filename = new URL("../src/features/events/components/EventsMap.tsx", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(filename);
  const listing = { id: 1, title: "Cooking", club: "Cooking club", occurrences: [] } as unknown as Event;
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let fits = 0;
  let openedEvents = 0;
  const exports = {} as { EventsMap: (props: object) => Node };
  interface Node { type: unknown; props: { children?: Node | Node[]; [key: string]: unknown } }
  const primitive = new Proxy({}, { get: (_, key) => String(key) });
  runInNewContext(source, { exports, require: (id: string) => {
    if (id.endsWith(".css")) return {};
    if (id === "react") return {
      useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
      useRef: () => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: null }); },
      useState: (initial: unknown) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
      useEffect: (fn: () => void) => fn(),
    };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-map-gl/mapbox") return { __esModule: true, default: "Map", Source: "Source", Layer: "Layer", Marker: "Marker", NavigationControl: "NavigationControl" };
    if (id.endsWith("useEventMap")) return { useEventMap: () => ({ query: { data: {}, isPending: false }, venues: [{ coordinates: [1, 2], events: [listing] }, { coordinates: [2, 3], events: [] }], center: [1, 2], mappedCount: 1, unmappedCount: 0 }) };
    if (id.endsWith("useEventMapMarkers")) return { useEventMapMarkers: () => ({ markers: [{ id: "venue:0", coordinates: [1, 2], events: [listing] }], refreshMarkers() {} }) };
    if (id.endsWith("eventMap.api")) return { MAPBOX_TOKEN: "test" };
    if (id.endsWith("useDarkMode")) return { useDarkMode: () => ({ isDarkMode: false }) };
    if (id.endsWith("useSchoolDirectory")) return { useSchoolDirectory: () => ({ getSchoolTimezone: () => "UTC" }) };
    if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) };
    if (id.endsWith("controlBox")) return { controlBox: { eventDiscovery: { views: { map_initial_zoom: 14 } } } };
    if (id.endsWith("utils/date")) return { formatCardDate: () => "Today", formatCardTime: () => "6 PM" };
    return primitive;
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.EventsMap({ events: [{ ...listing }], school: "uwaterloo", onEventClick() { openedEvents++; } }); };
  const find = (node: Node, predicate: (node: Node) => boolean): Node | undefined => {
    if (!node?.props) return undefined;
    if (predicate(node)) return node;
    return [node.props.children].flat(2).flatMap(child => child ? [find(child, predicate)] : []).find(Boolean);
  };
  let tree = render();
  const map = find(tree, node => node.type === "Map")!;
  refs[0].current = { fitBounds() { fits++; }, jumpTo() { fits++; } };
  (map.props.onLoad as () => void)();
  expect(fits).toBe(1);
  tree = render();
  (find(tree, node => node.props.className === "event-map-marker")!.props.onClick as () => void)();
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeDefined();
  (find(tree, node => node.props.className === "event-map-row")!.props.onClick as () => void)();
  expect(openedEvents).toBe(1);
  tree = render();
  expect(fits).toBe(1);
  (find(tree, node => node.props["aria-label"] === "common.close")!.props.onClick as () => void)();
  tree = render();
  expect(find(tree, node => node.type === "aside")).toBeUndefined();
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
  runInNewContext(source, { exports, require: () => ({
    useState: () => [markers, (value: typeof markers) => { markers = value; }],
    useRef: () => ({ current: 0 }), useEffect: () => {}, useCallback: (fn: unknown) => fn,
  }) });
  const hook = exports.useEventMapMarkers({ current: {
    isSourceLoaded: () => true, getBounds: () => ({ contains: () => true }),
    querySourceFeatures: () => [cluster, cluster],
    getSource: () => ({ getClusterLeaves: (_id: number, count: number, _offset: number, callback: (error: null, leaves: object[]) => void) => {
      leafReads++; expect(count).toBe(2); callback(null, [{ properties: { index: 0 } }, { properties: { index: 1 } }]);
    } }),
  } }, venues);
  await hook.refreshMarkers();
  expect(leafReads).toBe(1);
  expect(markers).toHaveLength(1);
  expect(markers[0].events.map(event => event.id)).toEqual([1, 2, 3]);
});
