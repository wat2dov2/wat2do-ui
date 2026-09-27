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

// Use the real React runtime, as in card-entrance.spec.ts, without a browser.
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
      if (id === "react-i18next") return {
        useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
      };
      if (id === "@/shared/hooks/useSchoolDirectory") return {
        useSchoolDirectory: () => ({ getSchoolTimezone: () => "America/Toronto" }),
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
