import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const require = createRequire(import.meta.url);
const { sessionInitScript }: typeof import("../src/features/auth/lib/sessionInitScript") =
  require("../src/features/auth/lib/sessionInitScript");

/** Runs the head script against a page whose browser storage holds `stored`. */
function runOn(stored: Record<string, unknown>) {
  const attributes: Record<string, string> = {};
  const styles: string[] = [];
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; } },
    createElement: () => ({ textContent: "" }),
    head: { appendChild: (element: { textContent: string }) => { styles.push(element.textContent); } },
  };
  const localStorage = {
    getItem: (key: string) => (key in stored ? JSON.stringify(stored[key]) : null),
  };
  new Function("document", "localStorage", sessionInitScript)(document, localStorage);
  return { attributes, styles };
}

const profile = {
  id: "user-1", role: "user", avatarUrl: null,
  clubs: [{ id: 21500, club_name: "Global Students Community UTSC", school: "utsc" }],
};

test("a browser with no cached sign-in is drawn signed out", () => {
  expect(runOn({})).toEqual({ attributes: {}, styles: [] });
});

test("a cached sign-in is drawn signed in, with its picture's place and its clubs' controls", () => {
  const { attributes, styles } = runOn({
    [STORAGE_KEYS.USER_EMAIL]: "tqiu@uwaterloo.ca",
    [STORAGE_KEYS.USER_PROFILE]: { ...profile, avatarUrl: "https://example.com/me.png" },
  });
  expect(attributes).toEqual({ "data-session": "signed-in", "data-session-avatar": "" });
  expect(styles).toEqual(['[data-manager-for="21500"]{display:contents!important}']);
});

test("an admin sees every club's controls", () => {
  const { attributes } = runOn({
    [STORAGE_KEYS.USER_EMAIL]: "admin@wat2do.io",
    [STORAGE_KEYS.USER_PROFILE]: { ...profile, role: "admin", clubs: [] },
  });
  expect(attributes).toEqual({ "data-session": "signed-in", "data-session-admin": "" });
});

test("only whole club numbers from storage become style rules", () => {
  const { styles } = runOn({
    [STORAGE_KEYS.USER_EMAIL]: "tqiu@uwaterloo.ca",
    [STORAGE_KEYS.USER_PROFILE]: { ...profile, clubs: [{ id: '1"]{}body{display:none}[x="' }, { id: 7 }, null] },
  });
  expect(styles).toEqual(['[data-manager-for="7"]{display:contents!important}']);
});
