import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { filterClubs, normalizeClub } from "../src/features/clubs/api/clubService";
import { useClubFiltersStore } from "../src/features/clubs/store/clubFilters.store";
import { filterPositions } from "../src/features/positions/api/positionService";
import { NO_POSITION_FILTERS, usePositionFiltersStore } from "../src/features/positions/store/positionFilters.store";
import { createDirectoryFiltersStore } from "../src/shared/store/directoryFilters.store";
import type { ApiClubResponse } from "../src/shared/generated";
import type { Position } from "../src/shared/types";

const clubs = [
  { id: 1, club_name: "Tech Club", categories: ["Technology"], event_count: 2 },
  { id: 2, club_name: "Board Games", categories: ["Social"], event_count: 1 },
  { id: 3, club_name: "Tech Society", categories: ["Technology", "Social"], event_count: 0 },
].map(club => normalizeClub({ ...club, club_type: "independent", school: "uwaterloo" } as ApiClubResponse));

const positions = [
  { id: 1, title: "Design lead", position_type: "committee" },
  { id: 2, title: "Design volunteer", position_type: "volunteer" },
  { id: 3, title: "Treasurer", position_type: "committee" },
].map(position => ({ ...position, description: "Join us", is_active: true, added_at: new Date().toISOString(), deadline_date: null }) as Position);

/**
 * Loads a directory page hook with React stubbed out: each `mount()` starts with
 * fresh component state, as the page does when the reader comes back to it.
 * The hook's filter store is the real one, read the way the component would.
 */
function loadPageHook<Hook extends (options: never) => unknown>(path: string, exportName: string, modules: Record<string, unknown>) {
  let state: unknown[] = [];
  let stateIndex = 0;
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const hookModule = { exports: {} as Record<string, Hook> };
  runInNewContext(outputText, {
    exports: hookModule.exports,
    require: (id: string) => {
      if (id === "react") return {
        useState: (initial: unknown) => {
          const index = stateIndex++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (next: unknown) => {
            state[index] = typeof next === "function" ? next(state[index]) : next;
          }];
        },
        useMemo: (factory: () => unknown) => factory(),
        useCallback: (callback: unknown) => callback,
      };
      if (id === "zustand/react/shallow") return { useShallow: (selector: unknown) => selector };
      if (id === "@/shared/hooks/useDiscoveryQueryTracking") return { useDiscoveryQueryTracking: () => undefined };
      if (id === "@/shared/constants/schools") return { resolveSchool: (school: string) => school };
      if (id === "@/shared/api/discovery.api") return { discoverySnapshotSeed: () => ({}) };
      if (id in modules) return modules[id];
      throw new Error(`unexpected import ${id}`);
    },
  });
  const hook = hookModule.exports[exportName]!;
  return {
    /** A fresh mount of the page. */
    mount: () => { state = []; },
    /** Renders the page again, keeping its component state. */
    render: (options: Parameters<Hook>[0]) => {
      stateIndex = 0;
      return hook(options) as ReturnType<Hook>;
    },
  };
}

test("directory search applies only on submit, trimmed, and counts every submission", () => {
  const store = createDirectoryFiltersStore({ kind: "all" });
  store.getState().setSearchQuery("  chess ");
  expect(store.getState().submittedSearch).toEqual({ query: "", revision: 0 });
  store.getState().submitSearch();
  store.getState().submitSearch();
  expect(store.getState().submittedSearch).toEqual({ query: "chess", revision: 2 });
  store.getState().setFilters({ kind: "new" });
  store.getState().setFilters((current) => ({ kind: `${current.kind}!` }));
  expect(store.getState().filters).toEqual({ kind: "new!" });
  store.getState().clearSearch();
  expect(store.getState()).toMatchObject({ searchQuery: "", submittedSearch: { query: "", revision: 3 }, filters: { kind: "new!" } });
  store.getState().searchFor("Treasurer", { kind: "all" });
  expect(store.getState()).toMatchObject({ searchQuery: "Treasurer", submittedSearch: { query: "Treasurer", revision: 4 }, filters: { kind: "all" } });
});

test("signing out starts a directory's search and filters over", () => {
  const page = new EventTarget();
  const global = globalThis as { window?: unknown };
  global.window = page;
  const store = createDirectoryFiltersStore({ kind: "all" });
  delete global.window;
  store.getState().setSearchQuery("chess");
  store.getState().submitSearch();
  store.getState().setFilters({ kind: "new" });
  page.dispatchEvent(new Event("auth-user-logout"));
  expect(store.getState()).toMatchObject({ searchQuery: "", submittedSearch: { query: "" }, filters: { kind: "all" } });
});

test("coming back to the clubs directory keeps its search, categories, minimum and scope", () => {
  const page = loadPageHook<typeof import("../src/features/clubs/hooks/useClubsPage").useClubsPage>(
    "../src/features/clubs/hooks/useClubsPage.ts", "useClubsPage", {
      "@/shared/hooks/useAppConstants": { useAppConstants: () => ({ club_categories: ["Social", "Technology"] }) },
      "@/features/clubs/store/savedClubs.store": { useSavedClubsStore: (select: (s: unknown) => unknown) => select({ savedClubIds: [1, 3], hasLoaded: true }) },
      "@/features/clubs/store/clubFilters.store": { useClubFiltersStore: (select: (s: unknown) => unknown) => select(useClubFiltersStore.getState()) },
      "@/features/auth/hooks/useAuthState": { useAuthState: () => ({ isAuthenticated: true, clubs: [] }) },
      "@tanstack/react-query": { useQuery: () => ({ data: { items: clubs }, isLoading: false, isLoadingError: false }) },
      "@/features/clubs/api/clubs.api": { clubDirectoryQueryOptions: () => ({}) },
      "@/features/clubs/api/clubService": { filterClubs },
    },
  );
  const options = { initialDirectory: null, initialSchool: "uwaterloo" };

  page.mount();
  let directory = page.render(options);
  expect(directory.clubs.map(club => club.id)).toEqual([1, 2, 3]);
  directory.setSearchQuery(" tech ");
  directory = page.render(options);
  directory.submitSearch();
  directory.toggleCategory("Technology");
  directory.setMinEvents(1);
  directory.setActiveTab("followed");

  // The reader opens a club, then comes back by "All clubs" or Back: a fresh page.
  page.mount();
  directory = page.render(options);
  expect(directory.searchQuery).toBe(" tech ");
  expect(directory.selectedCategories).toEqual(["Technology"]);
  expect(directory.minEvents).toBe(1);
  expect(directory.activeTab).toBe("followed");
  expect(directory.clubs.map(club => club.id)).toEqual([1]);

  directory.clearSearch();
  directory.toggleCategory("Technology");
  directory.setMinEvents(0);
  directory.setActiveTab("all");
  page.mount();
  expect(page.render(options).clubs.map(club => club.id)).toEqual([1, 2, 3]);
});

test("coming back to the positions directory keeps its search and role type, never the open position", () => {
  const page = loadPageHook<typeof import("../src/features/positions/hooks/usePositionsPage").usePositionsPage>(
    "../src/features/positions/hooks/usePositionsPage.ts", "usePositionsPage", {
      "@/features/positions/store/positionFilters.store": {
        NO_POSITION_FILTERS,
        usePositionFiltersStore: (select: (s: unknown) => unknown) => select(usePositionFiltersStore.getState()),
      },
      "@tanstack/react-query": { useQuery: () => ({ data: { items: positions, latest_added_position: { title: "Treasurer" } }, isLoading: false, isLoadingError: false }) },
      "@/features/positions/api/positions.api": { positionDirectoryQueryOptions: () => ({}) },
      "@/features/positions/api/positionService": { filterPositions },
    },
  );
  const options = { initialDirectory: null, initialSchool: "uwaterloo" };

  page.mount();
  let directory = page.render(options);
  directory.setSearchQuery("design");
  directory = page.render(options);
  directory.submitSearch();
  directory.setPositionType("committee");
  directory = page.render(options);
  directory.openPosition(directory.positions[0]!);
  expect(page.render(options).selectedPosition?.id).toBe(1);

  // The reader follows the position's club, then comes back with Back: a fresh page.
  page.mount();
  directory = page.render(options);
  expect(directory.searchQuery).toBe("design");
  expect(directory.positionType).toBe("committee");
  expect(directory.positions.map(position => position.id)).toEqual([1]);
  expect(directory.selectedPosition).toBeNull();

  directory.searchLatest();
  page.mount();
  directory = page.render(options);
  expect(directory.searchQuery).toBe("Treasurer");
  expect(directory.positionType).toBe("all");
  expect(directory.positions.map(position => position.id)).toEqual([3]);
  directory.clearSearch();
});
