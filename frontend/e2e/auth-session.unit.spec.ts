import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import authentication from "../../backend/controlbox/authentication.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { initializeAuth }: typeof import("../src/features/auth/api/auth.api") =
  require("../src/features/auth/api/auth.api");
const {
  clearAllAuthData, loadUserEmail, saveUserEmail, saveUserProfile,
}: typeof import("../src/features/auth/api/userRepository") =
  require("../src/features/auth/api/userRepository");

const SIGNED_IN = `${authentication.signed_in_cookie}=1`;
const SIGNED_OUT = `${authentication.signed_in_cookie}=0`;
const EMAIL = "ada@student.ubc.ca";
const originalGlobals = new Map(
  ["window", "document", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const requests: Array<{ path: string; method: string; credentials?: RequestCredentials }> = [];
let refreshStatus = 200;

/** A campus page on its own origin: its cookies, its storage, and the API behind /api. */
function openCampus(cookie = "") {
  const storage = new Map<string, string>();
  const window = Object.assign(new EventTarget(), {
    location: { origin: "https://ubc.wat2do.io" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie } });
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), window.location.origin).pathname;
    requests.push({ path, method: init?.method ?? "GET", credentials: init?.credentials });
    if (path === "/api/auth/refresh") {
      return refreshStatus === 200
        ? Response.json({ access_token: "token", token_type: "bearer", expires_in: 900, user_id: "auth-1" })
        : Response.json({ detail: "No refresh token" }, { status: refreshStatus });
    }
    if (path === "/api/users/me") {
      return Response.json({ id: "user-1", email: EMAIL, school: "ubc", role: "user", interests: [] });
    }
    if (path === "/api/clubs/mine") return Response.json([]);
    throw new Error(`Unexpected request to ${path}`);
  };
  clearAllAuthData();
}

function cacheSession(kind: "email" | "profile") {
  if (kind === "email") saveUserEmail(EMAIL);
  else {
    saveUserProfile({
      id: "user-1", fullName: null, avatarUrl: null, faculty: "", interests: [], isFirstYear: false,
      school: "ubc", role: "user", hasClub: false, clubs: [], clubId: null, clubName: null,
      payoutEmail: null, promoterTosAcceptedAt: null, promoterTosVersion: null,
    });
  }
}

const askedToRefresh = () => requests.some((request) => request.path === "/api/auth/refresh");

test.afterEach(() => {
  clearAllAuthData();
  requests.length = 0;
  refreshStatus = 200;
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("a browser the API found signed out loads without asking for a session", async () => {
  openCampus(`theme=dark; ${SIGNED_OUT}`);
  expect(await initializeAuth()).toBe(false);
  expect(requests).toEqual([]);
});

for (const [situation, cookie] of [
  ["a new browser, or one whose session predates the cookie", "theme=dark"],
  ["a cookie that only starts with the same name", `${authentication.signed_in_cookie}_old=0`],
] as const) {
  test(`with no answer from the API yet (${situation}) the page asks once, and the answer stops the next ask`, async () => {
    openCampus(cookie);
    refreshStatus = 401;
    expect(await initializeAuth()).toBe(false);
    expect(askedToRefresh()).toBe(true);

    // The 401 told the browser it holds no session.
    document.cookie = `${cookie}; ${SIGNED_OUT}`;
    requests.length = 0;
    expect(await initializeAuth()).toBe(false);
    expect(requests).toEqual([]);
  });
}

test("the signed-in cookie restores a session on a campus that cached nothing", async () => {
  openCampus(`theme=dark; ${SIGNED_IN}`);
  expect(await initializeAuth()).toBe(true);
  expect(requests[0]).toEqual({ path: "/api/auth/refresh", method: "POST", credentials: "include" });
  expect(requests.slice(1).map((request) => request.path).sort()).toEqual(["/api/clubs/mine", "/api/users/me"]);
  expect(loadUserEmail()).toBe(EMAIL);
});

for (const kind of ["email", "profile"] as const) {
  test(`a cached ${kind} is checked even after the API found the browser signed out`, async () => {
    openCampus(SIGNED_OUT);
    cacheSession(kind);
    refreshStatus = 401;
    expect(await initializeAuth()).toBe(false);
    expect(askedToRefresh()).toBe(true);
    expect(loadUserEmail()).toBeNull();
  });
}

for (const status of [429, 503]) {
  test(`a refresh that fails with ${status} keeps the cached session for the next load`, async () => {
    openCampus(SIGNED_IN);
    cacheSession("email");
    refreshStatus = status;
    expect(await initializeAuth()).toBe(false);
    expect(loadUserEmail()).toBe(EMAIL);
  });
}
