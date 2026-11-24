import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { claimClubHref, isClaimRequested }: typeof import("../src/features/clubs/lib/claimClub") =
  require("../src/features/clubs/lib/claimClub");
const { buildPreviewEvent }: typeof import("../src/features/events/lib/previewEvent") =
  require("../src/features/events/lib/previewEvent");
const { getEventFormDefaults }: typeof import("../src/features/events/hooks/useEventForm.utils") =
  require("../src/features/events/hooks/useEventForm.utils");

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const UNCLAIMED = {
  id: 4821,
  club_name: "Waterloo Board Games Club",
  status: "approved" as const,
  categories: [],
  club_page: "",
  ig: "uwboardgames",
  discord: null,
  club_type: "club",
  school: "uwaterloo",
  verified: false,
};

function openSite(origin: string) {
  const url = new URL(origin);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: url.origin, protocol: url.protocol, hostname: url.hostname, port: url.port } },
  });
}

function previewFor(club: typeof UNCLAIMED | undefined) {
  return buildPreviewEvent({
    school: club?.school ?? "uwaterloo",
    formData: { ...getEventFormDefaults("America/Toronto"), title: "Board game night", club_id: club?.id ?? null },
    imagePreview: "",
    club,
    fallbackTitle: "Event Title",
  });
}

test.afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("the claim link opens the club's page on this school's site with its claim form open", () => {
  expect(claimClubHref(UNCLAIMED, "uwaterloo")).toBe("/clubs/4821?claim=1");
});

test("the claim link for another school's club goes to that school's site", () => {
  openSite("https://uwaterloo.wat2do.io");
  expect(claimClubHref({ id: 21500, school: "utsc" }, "uwaterloo")).toBe("https://utsc.wat2do.io/clubs/21500?claim=1");
});

test("a club page opens its claim form only for the claim link's address", () => {
  expect(isClaimRequested(new URLSearchParams("claim=1"))).toBe(true);
  expect(isClaimRequested(new URLSearchParams("tab=positions&claim=1"))).toBe(true);
  expect(isClaimRequested(new URLSearchParams("tab=positions"))).toBe(false);
  expect(isClaimRequested(new URLSearchParams("claim=0"))).toBe(false);
});

test("the event a form sends carries its club and whether the club is claimed", () => {
  const unclaimed = previewFor(UNCLAIMED);
  expect(unclaimed.club).toBe("Waterloo Board Games Club");
  expect(unclaimed.club_id).toBe(4821);
  expect(unclaimed.verified).toBe(false);

  const claimed = previewFor({ ...UNCLAIMED, verified: true });
  expect(claimed.verified).toBe(true);
});

test("an event with no club picked names no club to claim", () => {
  const event = previewFor(undefined);
  expect(event.club).toBeNull();
  expect(event.club_id).toBeNull();
  expect(event.verified).toBe(false);
});
