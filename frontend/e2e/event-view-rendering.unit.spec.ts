import { expect, test } from "@playwright/test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Calendar, type CalendarProps } from "react-big-calendar";
import type { CalendarEvent } from "../src/features/events/lib/calendarEvents";
import type { Event } from "../src/shared/types";

type UIStoreModule = typeof import("../src/shared/store/ui.store");
type EventListModule = typeof import("../src/features/events/components/EventList");
const componentModules = new Map<string, object>();

// Use the real React runtime, as in card-entrance.unit.spec.ts, without a browser.
// Only the school/translation context and individual cards are fixtures.
function loadComponent(path: string, overrides?: Record<string, object>): object {
  const cached = overrides ? undefined : componentModules.get(path);
  if (cached) return cached;
  const filename = new URL(`../src/${path}.tsx`, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const componentModule = { exports: {} };
  if (!overrides) componentModules.set(path, componentModule.exports);
  const require = createRequire(filename);
  runInNewContext(outputText, {
    exports: componentModule.exports,
    require: (id: string) => {
      if (overrides && id in overrides) return overrides[id];
      if (id.endsWith(".css")) return {};
      if (id === "@/features/positions/hooks/usePositionStats") return { usePositionStats: () => ({ data: undefined }) };
      if (id === "next/navigation") return { useRouter: () => ({ replace() {}, push() {} }) };
      if (id.endsWith(".png")) return { src: "/logo.png", width: 57, height: 40 };
      if (id === "@/features/auth/hooks/useAuthState") return { useAuthState: () => ({ isAuthenticated: false }) };
      if (id === "@/features/auth/hooks/useEmailOtpFlow") return {
        useEmailOtpFlow: () => ({ email: "", otpToken: "", emailSent: false, isLoading: false, isFormValid: false }),
      };
      if (id === "react-i18next") return {
        useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
        Trans: ({ values }: { values: { title: string } }) => createElement("span", null, values.title),
      };
      if (id === "@/shared/hooks/useSchoolDirectory") return {
        useSchoolDirectory: () => ({ getSchoolTimezone: () => "America/Toronto", schoolBySlug: new Map() }),
      };
      if (id === "@/features/events/components/EventCard") return {
        EventCard: ({ event }: { event: Event }) => createElement("article", { "data-event-id": event.id }, event.title),
      };
      if (id === "@/features/events/components/EventCardSkeleton") return {
        EventCardSkeleton: () => createElement("article", { "aria-busy": true }),
      };
      if (id === "@/shared/feedback") return loadComponent("shared/feedback/empty-state");
      if (id.startsWith("@/")) {
        if (existsSync(new URL(`../src/${id.slice(2)}.tsx`, import.meta.url))) {
          return loadComponent(id.slice(2));
        }
        return require(new URL(`../src/${id.slice(2)}`, import.meta.url).pathname);
      }
      return require(id);
    },
  });
  return componentModule.exports;
}

function loadUIStore(savedPreferences: string | null) {
  const filename = new URL("../src/shared/store/ui.store.ts", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} as UIStoreModule };
  const listeners = new Map<string, () => void>();
  const storage = new Map(savedPreferences ? [["wat2do-app-prefs", savedPreferences]] : []);
  runInNewContext(outputText, {
    exports: module.exports,
    require: createRequire(filename),
    document: {},
    window: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    },
  });
  return { store: module.exports.useUIStore, logout: () => listeners.get("auth-user-logout")?.() };
}

const { EventList } = loadComponent("features/events/components/EventList") as EventListModule;
const event: Event = {
  id: 316, title: "UTSG campus event", school: "utsg", club: "U of T Club",
  category: "Career", price: 0, food: [], registration: false,
  occurrences: [{ dtstart_utc: new Date(Date.now() + 86_400_000).toISOString(), dtend_utc: null }],
} as Event;

function goingSelection(fixture: Event, currentTimeMs: number, selectedIds: string[] = []) {
  const filename = new URL("../src/features/events/hooks/useGoingEvents.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {} as typeof import("../src/features/events/hooks/useGoingEvents");
  const require = createRequire(filename);
  runInNewContext(source, { exports, require: (id: string) => {
    if (id === "react") return { useEffect() {}, useMemo: (fn: () => unknown) => fn(), useState: () => [currentTimeMs, () => {}] };
    if (id === "@tanstack/react-query") return { useQueryClient: () => ({}), useQuery: () => ({ data: [{ event_id: fixture.id, occurrence_ids: selectedIds }] }), useMutation: () => ({ isPending: false }) };
    if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key }) };
    if (id === "@/features/auth/hooks/useAuthState") return { useAuthState: () => ({ isAuthenticated: true }) };
    if (id === "@/features/auth/api/auth.api") return { getUserId: () => "test-user" };
    if (id === "@/shared/config/controlBox") return { controlBox: { clientCache: { liveEventDataStaleMs: 0 } } };
    if (id === "@/shared/lib/queryKeys" || id === "@/shared/utils/date") return require(new URL(`../src/${id.slice(2)}`, import.meta.url).pathname);
    return {};
  } });
  return exports.useGoingEventSelection(fixture, "uwaterloo");
}

test("Going excludes started sessions while recurring events retain their future dates", () => {
  const now = Date.parse("2026-10-07T22:00:00Z");
  const started = { id: "started", dtstart_utc: new Date(now - 60_000).toISOString(), dtend_utc: new Date(now + 3_600_000).toISOString() };
  const future = { id: "future", dtstart_utc: new Date(now + 60_000).toISOString(), dtend_utc: null };
  for (const occurrence of [started, { ...started, dtend_utc: null }, { ...started, dtstart_utc: new Date(now).toISOString() }, { ...started, dtstart_utc: "invalid" }]) {
    const result = goingSelection({ ...event, occurrences: [occurrence] } as Event, now);
    expect(result.selectableOccurrences).toHaveLength(0);
    expect(result.isTimeUnavailable).toBe(true);
  }
  const recurring = goingSelection({ ...event, occurrences: [started, future] } as Event, now);
  expect(recurring.selectableOccurrences.map(item => item.id)).toEqual(["future"]);
  expect(recurring.isTimeUnavailable).toBe(false);
  expect(goingSelection({ ...event, cancelled: true, occurrences: [future] } as Event, now).isTimeUnavailable).toBe(true);
});

test("started Going selections retain confirmation and cancellation until the session ends", () => {
  const now = Date.parse("2026-10-07T22:00:00Z");
  const occurrence = { id: "selected", dtstart_utc: new Date(now - 60_000).toISOString(), dtend_utc: new Date(now + 3_600_000).toISOString() };
  const result = goingSelection({ ...event, occurrences: [occurrence] } as Event, now, ["selected"]);
  expect(result.isActive).toBe(true);
  expect(result.selectableOccurrences).toHaveLength(0);
  expect(result.selectedSelectableIds).toHaveLength(0);
  expect(goingSelection({ ...event, occurrences: [{ ...occurrence, dtend_utc: new Date(now - 1).toISOString() }] } as Event, now, ["selected"]).isActive).toBe(false);
});

test("the attendance clock updates at the start instant instead of waiting for the next minute", () => {
  const now = Date.parse("2026-10-07T22:00:00Z");
  const filename = new URL("../src/features/events/hooks/useGoingEvents.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {} as typeof import("../src/features/events/hooks/useGoingEvents");
  const timers: { delay: number; callback: () => void }[] = [];
  const updatedTimes: number[] = [];
  const cleanups: (() => void)[] = [];
  const cleared: number[] = [];
  const contextDate = function(value: string) { return new Date(value); };
  contextDate.now = () => now;
  const runtime = { exports, Date: contextDate, window: {
    setTimeout: (callback: () => void, delay: number) => { timers.push({ delay, callback }); return timers.length; },
    setInterval: () => 99, clearTimeout: (id: number) => cleared.push(id), clearInterval() {},
  }, require: (id: string) => id === "react" ? {
    useState: () => [now, (value: number) => updatedTimes.push(value)],
    useEffect: (fn: () => (() => void) | undefined) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
  } : {} };
  runInNewContext(source, runtime);
  exports.useCurrentTime([{ dtstart_utc: new Date(now + 1250).toISOString() }, { dtstart_utc: new Date(now + 60_000).toISOString() }]);
  expect(timers.map(timer => timer.delay)).toEqual([0, 1250]);
  timers[1].callback();
  expect(updatedTimes).toEqual([now]);
  cleanups.forEach(cleanup => cleanup());
  expect(cleared).toEqual([1, 2]);
});

test("an open occurrence picker drops drafts that have started before confirmation", async () => {
  const filename = new URL("../src/features/events/components/GoingOccurrencePickerContent.tsx", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {} as typeof import("../src/features/events/components/GoingOccurrencePickerContent");
  const require = createRequire(filename);
  let stateIndex = 0;
  runInNewContext(source, { exports, require: (id: string) => {
    if (id === "react") return { useCallback: (fn: unknown) => fn, useState: () => [stateIndex++ === 0 ? ["started", "future"] : false, () => {}] };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) };
    if (id === "@/shared/utils/date") return { formatOccurrence: () => "Tomorrow" };
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  interface Node { type: unknown; props: { children?: Node | Node[]; [key: string]: unknown } }
  const find = (node: Node, type: string): Node | undefined => {
    if (!node?.props) return undefined;
    return node.type === type ? node : [node.props.children].flat(2).map(child => find(child as Node, type)).find(Boolean);
  };
  let submitted: string[] | null = null;
  const render = (occurrences: Event["occurrences"]) => {
    stateIndex = 0;
    return exports.GoingOccurrencePickerContent({ timeZone: "America/Toronto", occurrences, selectedIds: [], isPending: false, onCancel() {}, onConfirm: async (ids) => { submitted = ids; } }) as Node;
  };
  const future = { id: "future", dtstart_utc: "2026-10-08T22:00:00Z", dtend_utc: null };
  const tree = render([future] as Event["occurrences"]);
  expect(find(tree, "MultiSelect")?.props.selected).toEqual(["future"]);
  const actions = (tree.props.children as Node[])[2].props.children as Node[];
  expect(actions[1].props.disabled).toBe(false);
  (actions[1].props.onClick as () => void)();
  await Promise.resolve();
  expect(submitted).toEqual(["future"]);
  const expired = render([]);
  const expiredActions = (expired.props.children as Node[])[2].props.children as Node[];
  expect(expiredActions[1].props.disabled).toBe(true);
  submitted = null;
  (expiredActions[1].props.onClick as () => void)();
  expect(submitted).toBeNull();
});

for (const mode of ["calendar", "map"]) {
  for (const version of [1, undefined]) {
    test(`legacy ${mode} preference (${version === undefined ? "no version" : "version 1"}) cannot hide the event feed`, () => {
      const saved = JSON.stringify({ state: { viewMode: mode }, version });
      const { store, logout } = loadUIStore(saved);

      const renderState = (state: object) => {
        // Exercise the old caller's value, if present, against the real list.
        // This regression fails when the persisted calendar/map path exists.
        const props: ComponentProps<typeof EventList> & { viewMode?: unknown } = {
          events: [event], eventStats: null, viewMode: Reflect.get(state, "viewMode"),
        };
        const html = renderToStaticMarkup(createElement(EventList, props));
        expect(html).toContain('data-event-id="316"');
        expect(html).toContain(event.title);
        expect(html).not.toContain("ViewComingSoon");
      };

      renderState(store.getInitialState());
      renderState(store.getState());
      store.getState().setShowFilterDropdown(true);
      store.getState().setShowCommandPalette(true);
      store.getState().setEditingEvent(event);
      expect(store.getState().showFilterDropdown).toBe(true);
      expect(store.getState().editingEvent).toEqual(event);
      store.getState().clearEditingEvent();
      expect(store.getState().editingEvent).toBeNull();
      store.getState().setEditingEvent(event);
      logout();
      expect(store.getState().showFilterDropdown).toBe(false);
      expect(store.getState().showCommandPalette).toBe(false);
      expect(store.getState().editingEvent).toBeNull();
      renderState(store.getState());
      renderState(loadUIStore(saved).store.getState());
    });
  }
}


test("login loading preserves the real form structure and disables unfinished route actions", () => {
  const { AuthEntryPage } = loadComponent("features/auth/pages/AuthEntryPage") as typeof import("../src/features/auth/pages/AuthEntryPage");
  const render = (isPending: boolean) => renderToStaticMarkup(createElement(AuthEntryPage, {
    isPending,
    preview: createElement("aside", { "data-preview": true }),
  }));
  const pending = render(true);
  const loaded = render(false);
  for (const html of [pending, loaded]) {
    expect(html).toContain("auth.heading");
    expect(html).toContain("auth.continueWithGoogle");
    expect(html).toContain('type="email"');
    expect(html).toContain("auth.skipToOnboarding");
    expect(html).toContain('data-preview="true"');
  }
  expect(pending).toMatch(/<fieldset[^>]*disabled=""/);
  expect(pending).not.toContain('autofocus=""');
  const structure = (html: string) => html.replace(/ disabled=""| autofocus=""/g, "");
  expect(structure(pending)).toBe(structure(loaded));
});


test("discovery headings show one latest-item placeholder without exposing placeholder text", () => {
  const { PageCountHeading } = loadComponent("shared/ui/page-count-heading") as typeof import("../src/shared/ui/page-count-heading");
  const render = (count: number | null, latest?: ComponentProps<typeof PageCountHeading>["latest"]) => renderToStaticMarkup(createElement(PageCountHeading, {
    count, label: "upcoming events", latest,
  }));
  const loading = render(null, null);
  expect(loading).toContain('data-slot="latest-added-item"');
  expect(loading.match(/data-slot="skeleton"/g)).toHaveLength(2);
  expect(loading).toContain("invisible");
  expect(render(null)).not.toContain('data-slot="latest-added-item"');
  expect(render(0, null)).not.toContain('data-slot="latest-added-item"');
  const loaded = render(12, { item: { title: "Campus lunch", added_at: new Date().toISOString() }, onSelect: () => {} });
  expect(loaded).toContain("Campus lunch");
  expect(loaded).not.toContain('data-slot="skeleton"');
});

test("server-rendered filter bars remain visibly disabled until controls can hydrate", () => {
  const { FilterBar } = loadComponent("shared/layout/filter-bar") as typeof import("../src/shared/layout/filter-bar");
  const { Button } = loadComponent("shared/ui/button") as typeof import("../src/shared/ui/button");
  const html = renderToStaticMarkup(createElement(FilterBar, {
    children: createElement(Button, { children: "New" }),
    trailing: createElement(Button, { children: "More filters" }),
  }));
  expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*aria-busy="true"/);
  expect(html).toContain("More filters");
});

test("the view selector keeps its label before hydration, like the day filter", () => {
  const { EventViewSelect } = loadComponent("features/events/components/EventViewSelect") as typeof import("../src/features/events/components/EventViewSelect");
  const { DateFilterSelect } = loadComponent("features/events/components/DateFilterSelect") as typeof import("../src/features/events/components/DateFilterSelect");
  const view = renderToStaticMarkup(createElement(EventViewSelect, { value: "map", onChange() {} }));
  const date = renderToStaticMarkup(createElement(DateFilterSelect, { school: "uwaterloo", value: "any", customDate: "", onChange() {} }));
  expect(view).toContain("events.views.map</span>");
  expect(date).toContain("events.dateFilter.any");
  expect(view).not.toContain('data-slot="skeleton"');
});

test("map clusters fan real event posters with attendance borders and club avatars in the sheet", () => {
  const posters = [
    { ...event, id: 1, title: "New event", added_at: new Date().toISOString(), featured: false },
    { ...event, id: 2, title: "Going event", added_at: new Date().toISOString(), featured: false },
    { ...event, id: 3, title: "Featured event", added_at: "2026-01-01T00:00:00Z", featured: true },
  ].map((item, index) => ({ ...item, source_image_url: `/poster-${index}.png`, club_logo_url: "/club.png", cohosts: [] }));
  const children = ({ children }: { children?: React.ReactNode }) => createElement("div", null, children);
  const require = createRequire(import.meta.url);
  const { EventsMap } = loadComponent("features/events/components/EventsMap", {
    react: { ...require("react"), useState: (initial: unknown) => [Array.isArray(initial) ? posters.map(item => item.id) : initial, () => {}] },
    "react-map-gl/mapbox": { __esModule: true, default: children, Source: children, Layer: () => null, Marker: children, NavigationControl: () => null },
    "@/features/events/api/eventMap.api": { MAPBOX_TOKEN: "test" },
    "@/features/events/hooks/useEventMap": { useEventMap: () => ({ query: { data: {}, isPending: false }, center: [1, 2], venues: [{ coordinates: [1, 2], events: posters }], mappedCount: 3, unmappedCount: 0 }) },
    "@/features/events/hooks/useEventMapMarkers": { useEventMapMarkers: () => ({ markers: [{ id: "cluster:1", coordinates: [1, 2], events: posters }], refreshMarkers() {} }) },
    "@/features/events/hooks/useGoingEvents": { useGoingEvents: () => ({ data: [{ event_id: 2, occurrence_ids: ["future"] }] }) },
  }) as typeof import("../src/features/events/components/EventsMap");
  const html = renderToStaticMarkup(createElement(EventsMap, { events: posters, allEvents: posters, school: "uwaterloo", onEventClick() {} }));
  expect(html).toContain('data-view="map"');
  expect(html).toContain('class="event-map-poster-stack" data-count="3"');
  expect(html.match(/class="event-map-poster" data-status="new"/g)).toHaveLength(2);
  expect(html.match(/class="event-map-poster" data-status="going"/g)).toHaveLength(2);
  expect(html.match(/class="event-map-poster" data-featured="true"/g)).toHaveLength(2);
  expect(html.match(/data-slot="avatar-stack"/g)).toHaveLength(3);
  for (let index = 0; index < 3; index++) expect(html).toContain(`poster-${index}.png`);
  expect(html).not.toContain('data-slot="select-trigger"');
});


test("event and position loading cards include the same measured New badge placeholder", () => {
  const { EventCardSkeleton } = loadComponent("features/events/components/EventCardSkeleton") as typeof import("../src/features/events/components/EventCardSkeleton");
  const { PositionList } = loadComponent("features/positions/components/PositionList") as typeof import("../src/features/positions/components/PositionList");
  const eventHtml = renderToStaticMarkup(createElement(EventCardSkeleton));
  const positionsHtml = renderToStaticMarkup(createElement(PositionList, { positions: [], isLoading: true, onPositionClick: () => {} }));
  expect(eventHtml.match(/data-slot="card-image-skeleton"/g)).toHaveLength(1);
  expect(positionsHtml.match(/data-slot="card-image-skeleton"/g)).toHaveLength(8);
  for (const html of [eventHtml, positionsHtml]) {
    expect(html).toContain("absolute top-0 left-0");
    expect(html).toContain("text-[11px]");
    expect(html).toContain("invisible");
    expect(html).toContain("events.new");
    expect(html).toContain('data-slot="event-image-face"');
  }
});

test("an unavailable integer filter disables its actual popover trigger", () => {
  const { IntegerFilter } = loadComponent("shared/ui/integer-filter") as typeof import("../src/shared/ui/integer-filter");
  const html = renderToStaticMarkup(createElement(IntegerFilter, {
    value: 0, active: false, disabled: true, onChange: () => {}, label: ">0 going", inputLabel: "Minimum going",
  }));
  expect(html).toMatch(/<button[^>]*disabled=""/);
  expect(html).toContain('aria-expanded="false"');
});


test("catalog arrival timestamps show an absolute school-local date and omit missing or invalid values", () => {
  const { AddedAt } = loadComponent("shared/ui/added-at") as typeof import("../src/shared/ui/added-at");
  const renderAdded = (value: string | null, timeZone = "America/Toronto") =>
    renderToStaticMarkup(createElement(AddedAt, { value, timeZone }));
  const html = renderAdded("2026-09-29T00:30:00Z");
  expect(html).toContain('dateTime="2026-09-29T00:30:00.000Z"');
  expect(html).toContain("Sep 28, 2026");
  expect(html).toContain("8:30 PM");
  expect(html).toContain("EDT");
  expect(renderAdded("2026-09-29T00:30:00Z", "America/Vancouver")).toContain("5:30 PM");
  expect(renderAdded(null)).toBe("");
  expect(renderAdded("not-a-date")).toBe("");
});


test("applied queries reset the main scroller without resetting initial or unchanged renders", () => {
  const filename = new URL("../src/shared/layout/filter-bar.tsx", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  let effect = () => {};
  let previous: { current: string | undefined } | undefined;
  const calls: ScrollToOptions[] = [];
  let rootAvailable = true;
  const componentModule = { exports: {} as typeof import("../src/shared/layout/filter-bar") };
  runInNewContext(outputText, {
    exports: componentModule.exports,
    document: { querySelector: (selector: string) => {
      expect(selector).toBe(".main-content-grid");
      return rootAvailable ? { scrollTo: (options: ScrollToOptions) => calls.push(options) } : null;
    } },
    require: (id: string) => {
      if (id === "react") return {
        useRef: (initial: string | undefined) => previous ??= { current: initial },
        useEffect: (callback: () => void) => { effect = callback; },
        useSyncExternalStore: () => true,
      };
      if (id === "@/shared/hooks/useHorizontalScrollFade") return { useHorizontalScrollFade: () => ({}) };
      if (id === "@/shared/constants/ui") return { MAIN_CONTENT_SCROLL_ROOT_SELECTOR: ".main-content-grid" };
      if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      return {};
    },
  });
  const render = (appliedQueryKey?: string) => {
    componentModule.exports.FilterBar({ children: null, appliedQueryKey });
    effect();
  };
  render("initial");
  render("initial");
  expect(calls).toHaveLength(0);
  render("category");
  expect(calls).toEqual([{ top: 0, behavior: "instant" }]);
  render("category");
  expect(calls).toHaveLength(1);
  render("cleared");
  expect(calls).toHaveLength(2);
  rootAvailable = false;
  expect(() => render("search")).not.toThrow();
});

for (const [minPrice, maxPrice, selected] of [["", "", false], ["", "0", true], ["0", "", true], ["5", "10", true]] as const) {
  test(`price trigger exposes the shared selected state for ${minPrice || "empty"}/${maxPrice || "empty"}`, () => {
    const { PriceFilter } = loadComponent("features/search/components/PriceFilter") as typeof import("../src/features/search/components/PriceFilter");
    const html = renderToStaticMarkup(createElement(PriceFilter, {
      minPrice, maxPrice, setMinPrice: () => {}, setMaxPrice: () => {},
    }));
    expect(html).toContain(`data-selected="${selected}"`);
    expect(html).toContain(`aria-pressed="${selected}"`);
  });
}


test("shared price fields expose translated min and max placeholders", () => {
  const { PriceRangeFields } = loadComponent("features/search/components/PriceFilter") as typeof import("../src/features/search/components/PriceFilter");
  const html = renderToStaticMarkup(createElement(PriceRangeFields, {
    minPrice: "", maxPrice: "", setMinPrice: () => {}, setMaxPrice: () => {},
  }));
  expect(html).toContain('placeholder="filters.min"');
  expect(html).toContain('placeholder="filters.max"');
});

test("shared Select trigger supplies its disclosure chevron", () => {
  const { Select, SelectTrigger, SelectValue } = loadComponent("shared/ui/select") as typeof import("../src/shared/ui/select");
  const html = renderToStaticMarkup(createElement(Select, { value: "grid" },
    createElement(SelectTrigger, { "aria-label": "View" }, createElement(SelectValue, null, "Grid"))));
  expect(html).toContain('data-slot="select-trigger"');
  expect(html.match(/<svg/g)).toHaveLength(1);
  expect(html).toContain('aria-hidden="true"');
});

test("calendar measures host rows consistently and its generated overflow control opens the selected day", () => {
  const states: unknown[] = [];
  let stateIndex = 0;
  const react = createRequire(import.meta.url)("react");
  const { EventsCalendar } = loadComponent("features/events/components/EventsCalendar", {
    react: {
      ...react,
      useMemo: (compute: () => unknown) => compute(),
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value: unknown) => { states[index] = value; }];
      },
    },
  }) as typeof import("../src/features/events/components/EventsCalendar");
  const render = () => {
    stateIndex = 0;
    const surface = EventsCalendar({ events: [event], school: "utsg", onEventClick: () => {} });
    return surface.props.children.props.children.props as CalendarProps<CalendarEvent>;
  };
  let props = render();
  props.onView!("month");
  props = render();
  type CalendarInstance = {
    props: CalendarProps<CalendarEvent>;
    getDrilldownView: (date: Date) => string;
    handleDrillDown: (date: Date, view: string) => void;
    state: { context: Record<string, unknown> };
  };
  const CalendarClass = (Calendar as unknown as {
    ControlledComponent: { new(props: CalendarProps<CalendarEvent>): CalendarInstance; defaultProps: CalendarProps<CalendarEvent> };
  }).ControlledComponent;
  const calendar = new CalendarClass({ ...CalendarClass.defaultProps, ...props, messages: {
    ...props.messages, showMore: count => `+${count} more`,
  } });
  const Month = createRequire(import.meta.url)("react-big-calendar/lib/Month").default as new(props: object) => {
    handleShowMore: (events: CalendarEvent[], date: Date, cell: object, slot: number, target: null) => void;
  };
  const month = new Month({
    popup: calendar.props.popup,
    doShowMoreDrillDown: calendar.props.doShowMoreDrillDown,
    getDrilldownView: calendar.getDrilldownView,
    onDrillDown: calendar.handleDrillDown,
  });
  const selectedDate = new Date(2026, 9, 20);
  const css = readFileSync(new URL("../src/features/events/components/events-calendar.css", import.meta.url), "utf8");
  // Month's measurement tile has no custom renderer. The outer tile contract
  // must size that empty probe and the real title/avatar body identically.
  const tileHeightRem = css.match(/\.events-calendar \.rbc-month-view \.rbc-event\s*\{[^}]*?\bheight:\s*([\d.]+)rem/)?.[1];
  const weekMinimumRem = css.match(/\.events-calendar \.rbc-month-row\s*\{[^}]*?min-height:\s*([\d.]+)rem/)?.[1];
  expect(tileHeightRem).toBeDefined();
  expect(weekMinimumRem).toBeDefined();
  const tileHeight = Number(tileHeightRem) * 16;
  expect(tileHeight).toBeGreaterThanOrEqual(45); // 15px title, 20px avatar, gap, padding and border.
  const rowHeight = tileHeight + 1; // The library's segment reserves one bottom pixel.
  const range = Array.from({ length: 7 }, (_, index) => new Date(2026, 9, 18 + index));
  const occurrences = Array.from({ length: 12 }, (_, index) => ({
    ...props.events![0], id: `overflow-${index}`,
    start: new Date(2026, 9, 20, 18), end: new Date(2026, 9, 20, 20),
  }));
  type Metrics = { levels: unknown[][]; extra: unknown[]; getEventsForSlot: (slot: number) => CalendarEvent[] };
  type ContentRow = {
    props: Record<string, unknown>;
    containerRef: { current: object };
    headingRowRef: { current: object };
    eventRowRef: { current: object };
    getRowLimit: () => number;
    renderDummy: () => React.ReactElement;
    slotMetrics: (props: object) => Metrics;
    handleShowMore: (slot: number, target: object) => void;
  };
  const require = createRequire(import.meta.url);
  const DateContentRow = require("react-big-calendar/lib/DateContentRow").default as new(props: object) => ContentRow;
  const EventEndingRow = require("react-big-calendar/lib/EventEndingRow").default as new(props: object) => {
    renderShowMore: (segments: unknown[], slot: number) => React.ReactElement<{ children: string; onClick: (event: object) => void }>;
  };
  const documentElement = { contains: () => true, scrollTop: 0, scrollLeft: 0 };
  const element = (height: number) => ({
    ownerDocument: { documentElement },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 700, height }),
  });
  for (const weekHeight of [Number(weekMinimumRem) * 16, 176]) {
    const row = new DateContentRow({
      ...calendar.props, ...calendar.state.context, range, events: occurrences, minRows: 0,
      renderHeader: ({ date }: { date: Date }) => createElement("span", { key: date.toISOString() }, "20"),
      onShowMore: month.handleShowMore,
    });
    row.containerRef.current = {
      ...element(weekHeight), querySelectorAll: () => [{ children: range.map(() => element(weekHeight)) }],
    };
    row.headingRowRef.current = element(24);
    row.eventRowRef.current = element(rowHeight);
    expect(renderToStaticMarkup(row.renderDummy())).toContain('class="rbc-event"');
    row.props = { ...row.props, maxRows: row.getRowLimit() };
    const metrics = row.slotMetrics(row.props);
    expect(metrics.extra.length).toBeGreaterThan(0);
    expect(metrics.getEventsForSlot(3)).toHaveLength(occurrences.length);
    // Reserve a full line for the ending row even in the smallest month cell.
    expect(metrics.levels.length * rowHeight + 24).toBeLessThanOrEqual(weekHeight - 24);
    const ending = new EventEndingRow({
      ...row.props, segments: metrics.extra, slotMetrics: metrics, onShowMore: row.handleShowMore,
    });
    const button = ending.renderShowMore(metrics.extra, 3);
    expect(button.props.children).toBe(`+${metrics.extra.length} more`);
    button.props.onClick({ target: {}, preventDefault() {}, stopPropagation() {} });
  }
  props = render();
  expect(props.date).toEqual(selectedDate);
  expect(props.view).toBe("day");

  const html = renderToStaticMarkup(createElement(props.components!.toolbar!, {
    label: "October 2026", onNavigate: () => {}, onView: () => {}, view: "month", views: ["month", "week", "day"], date: selectedDate, localizer: props.localizer,
  }));
  expect(html).toContain("events.views.previous");
  expect(html).toContain("events.views.next");
  expect(html).not.toContain("filters.today");
  expect(html).toContain("events.views.day");
});

test("calendar tiles retain host and cohost pictures and route selection to the shared event drawer", () => {
  const require = createRequire(import.meta.url);
  const react = require("react");
  const selected: Event[] = [];
  const listing: Event = {
    ...event, club_logo_url: "https://example.com/host.png",
    cohosts: [{ club_name: "Co-host Club", logo_url: "https://example.com/cohost.png" }],
  } as Event;
  const { EventsCalendar } = loadComponent("features/events/components/EventsCalendar", {
    react: { ...react, useMemo: (compute: () => unknown) => compute(), useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}] },
  }) as typeof import("../src/features/events/components/EventsCalendar");
  const surface = EventsCalendar({ events: [listing], school: "utsg", onEventClick: item => selected.push(item) });
  const props = surface.props.children.props.children.props as CalendarProps<CalendarEvent>;
  const occurrence = props.events![0];
  const { TooltipProvider } = loadComponent("shared/ui/tooltip") as typeof import("../src/shared/ui/tooltip");
  const html = renderToStaticMarkup(createElement(TooltipProvider, null,
    createElement(props.components!.event!, { event: occurrence, title: occurrence.title })));
  expect(html).toContain(listing.title);
  expect(html).toContain(listing.club);
  expect(html).toContain('src="https://example.com/host.png"');
  expect(html).toContain('src="https://example.com/cohost.png"');
  expect(html).not.toContain("<button");
  props.onSelectEvent!(occurrence, {} as React.SyntheticEvent<HTMLElement>);
  expect(selected).toEqual([listing]);
});
