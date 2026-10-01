import { expect, test } from "@playwright/test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Event } from "../src/shared/types";

type UIStoreModule = typeof import("../src/shared/store/ui.store");
type EventListModule = typeof import("../src/features/events/components/EventList");
const componentModules = new Map<string, object>();

// Use the real React runtime, as in card-entrance.unit.spec.ts, without a browser.
// Only the school/translation context and individual cards are fixtures.
function loadComponent(path: string): object {
  const cached = componentModules.get(path);
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
  componentModules.set(path, componentModule.exports);
  const require = createRequire(filename);
  runInNewContext(outputText, {
    exports: componentModule.exports,
    require: (id: string) => {
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
