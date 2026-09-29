import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { queryKeys } from "../src/shared/lib/queryKeys";
import { filterClubs, normalizeClub, resolveClubByInstagramHandle } from "../src/features/clubs/api/clubService";
import { normalizeInstagramHandle } from "../src/shared/utils/url";
import type { ApiClubResponse } from "../src/shared/generated";

const { getClubDirectorySnapshot }: typeof import("../src/features/clubs/api/clubDirectory.server") =
  createRequire(import.meta.url)("../src/features/clubs/api/clubDirectory.server");
const clubs = [
  { id: 1, club_name: "Tech Club", categories: ["Technology"], event_count: 2 },
  { id: 2, club_name: "Board Games", categories: ["Social"], event_count: 1 },
  { id: 3, club_name: "Tech Society", categories: ["Technology", "Social"], event_count: 0 },
].map(club => normalizeClub({ ...club, club_type: "independent", school: "uwaterloo" } as ApiClubResponse));
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("loads every campus page before publishing the cached directory", async () => {
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url);
    const page = Number(url.searchParams.get("page"));
    return Response.json({ items: [clubs[page - 1]], total: 3, page, page_size: 1, total_pages: 3 });
  };
  const directory = await getClubDirectorySnapshot("uwaterloo");
  expect(directory.items).toEqual(clubs);
  expect(directory.total).toBe(3);
  expect(directory.total_pages).toBe(1);
  expect(requests.map(url => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  expect(requests.every(url => url.searchParams.get("school") === "uwaterloo")).toBe(true);
});

test("rejects a failed later page rather than caching a partial directory", async () => {
  globalThis.fetch = async input => new URL(String(input)).searchParams.get("page") === "1"
    ? Response.json({ items: [clubs[0]], total: 2, page: 1, page_size: 1, total_pages: 2 })
    : new Response(null, { status: 503 });
  await expect(getClubDirectorySnapshot("uwaterloo")).rejects.toThrow("503");
});

test("combines cached search, OR categories, minimum count and membership without mutation", () => {
  const filters = { search: " TECH ", categories: ["Social", "Technology"], minEvents: 1 };
  expect(filterClubs(clubs, filters).map(club => club.id)).toEqual([1]);
  expect(filterClubs(clubs, { ...filters, ids: [] })).toEqual([]);
  expect(filterClubs(clubs, { ...filters, minEvents: 0, ids: [3] }).map(club => club.id)).toEqual([3]);
  expect(filterClubs(clubs, { search: "", categories: [], minEvents: 0 })).toEqual(clubs);
  expect(clubs.map(club => club.id)).toEqual([1, 2, 3]);
});

test("switching managed clubs hides old rows immediately and ignores late roster responses", async () => {
  let clubId = 1;
  const state: unknown[] = [];
  let stateIndex = 0;
  let effect: (() => void | (() => void)) | undefined;
  const pending = new Map<number, (members: unknown[]) => void>();
  const t = (key: string) => key;
  const filename = new URL("../src/features/club-panel/pages/ClubPanelMembersPage.tsx", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const pageModule = { exports: {} as typeof import("../src/features/club-panel/pages/ClubPanelMembersPage") };
  runInNewContext(outputText, {
    exports: pageModule.exports,
    require: (id: string) => {
      if (id === "react") return {
        useState: (initial: unknown) => {
          const index = stateIndex++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (next: unknown) => {
            state[index] = typeof next === "function" ? next(state[index]) : next;
          }];
        },
        useEffect: (callback: () => void | (() => void)) => { effect = callback; },
        useCallback: (callback: unknown) => callback,
      };
      if (id === "react/jsx-runtime") return {
        jsx: (_type: unknown, props: unknown) => props,
        jsxs: (_type: unknown, props: unknown) => props,
      };
      if (id === "react-i18next") return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
      if (id === "@/features/auth") return { useAuthState: () => ({ clubId }) };
      if (id === "next/navigation") return { useRouter: () => ({ push: () => undefined }) };
      if (id === "@tanstack/react-query") return { useQuery: () => ({ data: { school: "uwaterloo" } }) };
      if (id === "@/shared/lib/queryKeys") return { queryKeys };
      if (id === "@/shared/hooks/useSchoolDirectory") return { useSchoolDirectory: () => ({ getSchoolTimezone: () => "America/Toronto" }) };
      if (id === "../api/members.api") return {
        fetchClubMembers: (requestedClubId: number) => new Promise((resolve) => pending.set(requestedClubId, resolve)),
        fetchClubInvitations: async () => [],
      };
      return {};
    },
  });
  const render = () => {
    stateIndex = 0;
    return JSON.stringify(pageModule.exports.ClubPanelMembersPage());
  };
  const members = (id: number) => [{ user_id: String(id), email: `manager-${id}@example.test`, full_name: `Manager ${id}`, role: "owner", joined_at: "2026-01-01" }];
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  render();
  let cleanup = effect?.();
  pending.get(1)?.(members(1));
  await settle();
  expect(render()).toContain("manager-1@example.test");

  clubId = 2;
  expect(render()).not.toContain("manager-1@example.test");
  if (cleanup) cleanup();
  cleanup = effect?.();
  clubId = 3;
  expect(render()).not.toContain("manager-1@example.test");
  if (cleanup) cleanup();
  cleanup = effect?.();

  pending.get(2)?.(members(2));
  await settle();
  const awaitingCurrentClub = render();
  expect(awaitingCurrentClub).not.toContain("manager-2@example.test");
  expect(awaitingCurrentClub).toContain('"aria-busy":"true"');
  pending.get(3)?.(members(3));
  await settle();
  expect(render()).toContain("manager-3@example.test");
  if (cleanup) cleanup();
});


test("organization input resolves only unambiguous Instagram identities, not display names", () => {
  const directory = [
    { ...clubs[0], club_name: "Same club name", ig: "@UW.Tech" },
    { ...clubs[1], club_name: "Same club name", ig: "https://www.instagram.com/board_games/?hl=en" },
  ];
  for (const handle of ["uw.tech", "@UW.TECH", "@@uw.tech", " https://instagram.com/uw.tech/?hl=en "]) {
    expect(resolveClubByInstagramHandle(directory, handle)?.id).toBe(1);
  }
  expect(resolveClubByInstagramHandle(directory, "@board_games")?.id).toBe(2);
  for (const value of ["", "Same club name", "missing", "https://example.com/uw.tech", "https://instagram.com/p/123/", "uw.tech/extra"]) {
    expect(resolveClubByInstagramHandle(directory, value)).toBeUndefined();
  }
  expect(resolveClubByInstagramHandle([...directory, { ...clubs[2], ig: "uw.tech" }], "@uw.tech")).toBeUndefined();
});

test("Instagram identity parsing keeps profile handles and rejects non-profile URLs", () => {
  expect(normalizeInstagramHandle("https://www.instagram.com/UW.Tech/?hl=en")).toBe("UW.Tech");
  expect(normalizeInstagramHandle("instagram.com/uw.tech/")).toBe("uw.tech");
  expect(normalizeInstagramHandle(" @uw.tech ")).toBe("uw.tech");
  expect(normalizeInstagramHandle("@@uw.tech")).toBe("uw.tech");
  for (const input of [null, undefined, "https://instagram.com/", "https://instagram.com/reels/", "https://instagram.com/user/post", "javascript:alert(1)", "https://instagram.com.evil.test/user"]) {
    expect(normalizeInstagramHandle(input)).toBe("");
  }
});


test("organization field submits canonical IDs while displaying the typed handle", () => {
  const directory = [{ ...clubs[0], ig: "uw.tech" }, { ...clubs[1], ig: "board_games" }];
  let value: number | null = null;
  let draft: unknown;
  const filename = new URL("../src/features/clubs/components/ClubInput.tsx", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const component = { exports: {} as typeof import("../src/features/clubs/components/ClubInput") };
  runInNewContext(outputText, {
    exports: component.exports,
    require: (id: string) => {
      if (id === "react") return { useState: (initial: unknown) => {
        draft ??= initial;
        return [draft, (next: unknown) => { draft = next; }];
      } };
      if (id === "react/jsx-runtime") return { jsx: (_type: unknown, props: unknown) => props };
      if (id === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key }) };
      if (id.endsWith("/clubService")) return { resolveClubByInstagramHandle };
      if (id.endsWith("/clubCardContent")) return { getClubSocialHandle: (club: { ig: string }) => `@${normalizeInstagramHandle(club.ig)}` };
      return {};
    },
  });
  const render = (availableClubs = directory) => component.exports.ClubInput({
    value, clubs: availableClubs, onChange: next => { value = next; }, touched: true,
  }) as unknown as { label: string; value: string; disabled: boolean; error?: string; onChange: (text: string) => void };
  expect(render([]).disabled).toBe(true);
  expect(render().disabled).toBe(false);
  expect(render().label).toBe("forms.instagramHandle");
  render().onChange("@UW.Tech");
  expect(value).toBe(1);
  expect(render().value).toBe("@UW.Tech");
  render().onChange("Tech Club");
  expect(value).toBeNull();
  expect(render().error).toBe("clubs.noClubsFound");
  render().onChange("https://instagram.com/board_games/");
  expect(value).toBe(2);
  render().onChange("");
  expect(value).toBeNull();
  expect(render().value).toBe("");
  value = 1;
  expect(render().value).toBe("@uw.tech");
});
