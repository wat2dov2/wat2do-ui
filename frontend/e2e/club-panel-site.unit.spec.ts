import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import authentication from "../../backend/controlbox/authentication.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { clubPanelUrlElsewhere }: typeof import("../src/features/clubs/lib/clubPanelSite") =
  require("../src/features/clubs/lib/clubPanelSite");
const { initializeAuth }: typeof import("../src/features/auth/api/auth.api") =
  require("../src/features/auth/api/auth.api");
const { clearAllAuthData, loadUserProfile }: typeof import("../src/features/auth/api/userRepository") =
  require("../src/features/auth/api/userRepository");

const originalGlobals = new Map(
  ["window", "document", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const UTSC_CLUB = { id: 21500, club_name: "Global Students Community UTSC", school: "utsc" };

/** A page on `origin`, with its own storage and the API behind /api. */
function openSite(origin: string) {
  const url = new URL(origin);
  const storage = new Map<string, string>();
  const window = Object.assign(new EventTarget(), {
    location: { origin: url.origin, protocol: url.protocol, hostname: url.hostname, port: url.port },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: `${authentication.signed_in_cookie}=1` },
  });
  globalThis.fetch = async (input) => {
    const path = new URL(String(input), url.origin).pathname;
    if (path === "/api/auth/refresh") {
      return Response.json({ access_token: "token", token_type: "bearer", expires_in: 900, user_id: "auth-1" });
    }
    if (path === "/api/users/me") {
      return Response.json({ id: "user-1", email: "tqiu@uwaterloo.ca", school: "uwaterloo", role: "user", interests: [] });
    }
    if (path === "/api/clubs/mine") return Response.json([{ ...UTSC_CLUB, status: "approved" }]);
    throw new Error(`Unexpected request to ${path}`);
  };
  clearAllAuthData();
}

test.afterAll(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("a club's panel opened on another school's site moves to the club's school, carrying the club", () => {
  openSite("https://uwaterloo.wat2do.io");
  expect(clubPanelUrlElsewhere(UTSC_CLUB, "/club-panel")).toBe("https://utsc.wat2do.io/club-panel?club=21500");
  expect(clubPanelUrlElsewhere(UTSC_CLUB, "/club-panel/events/38592?view=door"))
    .toBe("https://utsc.wat2do.io/club-panel/events/38592?view=door&club=21500");
});

test("a club's panel stays where it is on its own school's site", () => {
  openSite("https://utsc.wat2do.io");
  expect(clubPanelUrlElsewhere(UTSC_CLUB, "/club-panel")).toBeNull();
  expect(clubPanelUrlElsewhere({ ...UTSC_CLUB, school: null }, "/club-panel")).toBeNull();
});

test("the site with no school moves a club's panel to its school", () => {
  openSite("https://wat2do.io");
  expect(clubPanelUrlElsewhere(UTSC_CLUB, "/club-panel/events/38592"))
    .toBe("https://utsc.wat2do.io/club-panel/events/38592?club=21500");
});

test("the signed-in profile knows each of the user's clubs' schools", async () => {
  openSite("https://uwaterloo.wat2do.io");
  expect(await initializeAuth()).toBe(true);
  expect(loadUserProfile()?.clubs).toEqual([UTSC_CLUB]);
});
