import { expect, type Page } from "@playwright/test";
import { test, type NextFixture } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const CODE = "7KQ2MZ4PABCDEFGHIJKLMNOP";
const EVENT_ID = 42;

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    status: "valid",
    paid: false,
    checked_in_at: null,
    event_id: EVENT_ID,
    event_title: "Board Games Night",
    event_date_id: "00000000-0000-0000-0000-000000000001",
    dtstart_utc: "2030-11-20T23:00:00Z",
    dtend_utc: "2030-11-21T02:00:00Z",
    location: "SLC Great Hall",
    club_id: 7,
    club_name: "Board Game Club",
    school: "uwaterloo",
    image_url: null,
    holder_name: "Ada L.",
    can_check_in: false,
    refund_requested_at: null,
    refund_declined_at: null,
    can_request_refund: false,
    can_return: true,
    ...overrides,
  };
}

/** A signed-in student; `clubs` makes them part of a club's team. */
async function signIn(page: Page, next: NextFixture, clubs: unknown[] = []) {
  await page.addInitScript((key) => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
  await mockApi(page, next, (url) => url.pathname === "/api/auth/refresh", () => ({
    json: { access_token: "token", token_type: "bearer", expires_in: 3600, user_id: "user-1" },
  }));
  await mockApi(page, next, (url) => url.pathname === "/api/users/me", () => ({
    json: { id: "user-1", email: "ada@uwaterloo.ca", school: "uwaterloo", role: "user", interests: [] },
  }));
  await mockApi(page, next, (url) => url.pathname === "/api/clubs/mine", () => ({ json: clubs }));
}

test("a holder shows their free ticket's QR code, and can give it back", async ({ page, next }) => {
  await signIn(page, next);
  let returned = false;
  await mockApi(page, next, (url) => url.pathname === `/api/tickets/${CODE}`, (request) => {
    if (request.method === "DELETE") {
      returned = true;
      return { status: 204, body: "" };
    }
    return { json: ticket() };
  });
  await mockApi(page, next, (url) => url.pathname === "/api/tickets/mine", () => ({ json: [] }));

  await page.goto(`/tickets/${CODE}`);
  await expect(page.getByRole("img", { name: "QR code for this ticket" })).toBeVisible();
  await expect(page.getByText("7KQ2 MZ4P ABCD EFGH IJKL MNOP")).toBeVisible();

  await page.getByRole("button", { name: "Can't make it? Give your ticket back" }).click();
  await page.getByRole("button", { name: "Give it back", exact: true }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  expect(returned).toBe(true);
});

test("someone on the club's team checks a scanned ticket in from its page", async ({ page, next }) => {
  await signIn(page, next, [{ id: 7, club_name: "Board Game Club", school: "uwaterloo" }]);
  let checkedIn: unknown = null;
  await mockApi(page, next, (url) => url.pathname === `/api/tickets/${CODE}`, () => ({
    json: ticket({ can_check_in: true, can_return: false, holder_name: "Ben T." }),
  }));
  await mockApi(
    page,
    next,
    (url) => url.pathname === `/api/events/${EVENT_ID}/ticketing/check-ins/${CODE}`,
    async (request) => {
      checkedIn = await request.json();
      return {
        json: {
          result: "checked_in",
          attendee: {
            id: "ticket-1",
            code: CODE,
            status: "valid",
            event_date_id: "00000000-0000-0000-0000-000000000001",
            holder_name: "Ben Tester",
            holder_email: "ben@uwaterloo.ca",
            issued_at: "2030-11-01T12:00:00Z",
            checked_in_at: "2030-11-20T23:05:00Z",
            refunded_at: null,
            amount_cents: 0,
            refund_requested_at: null,
            refund_request_note: null,
            refund_declined_at: null,
          },
        },
      };
    },
  );

  await page.goto(`/tickets/${CODE}`);
  await expect(page.getByText("You run Board Game Club, so you can check this ticket in.")).toBeVisible();
  await page.getByRole("button", { name: "Check in" }).click();
  await expect.poll(() => checkedIn).toEqual({ checked_in: true });
});

test("the door scanner checks in a typed code and covers the camera with the result", async ({ page, next }) => {
  await signIn(page, next, [{ id: 7, club_name: "Board Game Club", school: "uwaterloo" }]);
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}/ticketing/desk`, () => ({
    json: {
      ticketing: {
        event_id: EVENT_ID,
        free: true,
        currency: null,
        paused: false,
        available: true,
        maximum_per_order: 1,
        releases: [{ id: "release-1", on_sale_at: "2030-11-01T12:00:00Z", quantity: 40, price_cents: 0, has_tickets: true }],
        dates: [],
      },
      issued: 12,
      checked_in: 3,
      refunded: 0,
      revenue_cents: 0,
      dates: [],
      attendees: [],
    },
  }));
  await mockApi(
    page,
    next,
    (url) => url.pathname.startsWith(`/api/events/${EVENT_ID}/ticketing/check-ins/`),
    () => ({ json: { result: "already_checked_in", attendee: null } }),
  );

  await page.goto(`/club-panel/events/${EVENT_ID}/scan`);
  await expect(page.getByText("3 of 12 checked in")).toBeVisible();
  // Typing a code is tucked away under the camera until asked for.
  await page.getByRole("button", { name: "Can't scan? Enter the code" }).click();
  await page.getByRole("textbox", { name: "Ticket code" }).fill("7kq2 mz4p abcd efgh ijkl mnop");
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Already checked in")).toBeVisible();
});

test("the club's team turns tickets on for some of an event's dates in the event's edit form, and saves from the save bar", async ({ page, next }) => {
  await signIn(page, next, [{ id: 7, club_name: "Board Game Club", school: "uwaterloo" }]);
  const dates = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
  const event = {
    id: EVENT_ID, club_id: 7, title: "Board Games Night", school: "uwaterloo", club: "Board Game Club",
    description: "Games and snacks", location: "SLC Great Hall", map_location: null, price: 0, food: [],
    registration: false, source_image_url: null, category: null, cancelled: false,
    added_at: "2030-11-01T00:00:00Z",
    occurrences: dates.map((id, index) => ({
      id, event_id: EVENT_ID,
      dtstart_utc: `2030-11-${20 + index * 7}T23:00:00Z`, dtend_utc: `2030-11-${21 + index * 7}T02:00:00Z`,
    })),
  };
  let saved: unknown = null;
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}`, () => ({ json: event }));
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}/ticketing`, async (request) => {
    if (request.method === "PUT") {
      saved = await request.json();
      return { json: { event_id: EVENT_ID, free: true, currency: null, paused: false, available: true,
        maximum_per_order: 1, releases: [], dates: [] } };
    }
    return { json: null };
  });
  await mockApi(page, next, (url) => url.pathname === "/api/clubs/7/payouts", () => ({ json: {
    paid_tickets_enabled: false, connected: false, charges_enabled: false, payouts_enabled: false,
    details_submitted: false, requirements_due: [], country: "CA", currency: "cad",
  } }));

  await page.goto(`/events/${EVENT_ID}`);
  // Tickets live in the edit form now; the event page has no Tickets button.
  const actions = page.locator('[data-slot="event-actions"]');
  await expect(actions.getByRole("link", { name: "Tickets" })).toHaveCount(0);
  await actions.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  const saveBar = page.getByTestId("save-bar");
  // An edit has no Update button: the save bar shows once something changed.
  await expect(form.getByRole("button", { name: "Update Event" })).toHaveCount(0);
  await expect(saveBar).toHaveCount(0);
  const tickets = form.locator('[data-slot="event-tickets"]');
  await expect(tickets.getByRole("link", { name: "Club Payout Terms" })).toBeVisible();
  await tickets.getByRole("switch").first().click();
  await expect(saveBar).toBeVisible();
  // Free only while paid tickets are off: no price, every date ticked to start with,
  // and one release on sale from now.
  await expect(tickets.getByLabel(/Ticket price/)).toHaveCount(0);
  await expect(tickets.getByRole("checkbox")).toHaveCount(2);
  await expect(tickets.getByLabel("Tickets per date")).toHaveCount(1);
  await tickets.getByRole("checkbox").nth(1).click();
  await tickets.getByRole("textbox", { name: "Tickets", exact: true }).fill("40");

  // A second release needs its own on-sale time before anything saves.
  await tickets.getByRole("button", { name: "Add a release" }).click();
  await saveBar.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tickets.getByText("Pick when this release goes on sale.")).toBeVisible();
  expect(saved).toBeNull();
  await tickets.getByRole("button", { name: "Remove release" }).nth(1).click();

  await saveBar.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved).toEqual({
    releases: [{ id: null, on_sale_at: expect.any(String), quantity: 40, price_cents: 0 }],
    paused: false,
    event_date_ids: [dates[0]],
  });
});

test("discarding an event edit puts the form back and hides the save bar", async ({ page, next }) => {
  await signIn(page, next, [{ id: 7, club_name: "Board Game Club", school: "uwaterloo" }]);
  const event = {
    id: EVENT_ID, club_id: 7, title: "Board Games Night", school: "uwaterloo", club: "Board Game Club",
    description: "Games and snacks", location: "SLC Great Hall", map_location: null, price: 0, food: [],
    registration: false, source_image_url: null, category: null, cancelled: false,
    added_at: "2030-11-01T00:00:00Z",
    occurrences: [{
      id: "00000000-0000-0000-0000-000000000001", event_id: EVENT_ID,
      dtstart_utc: "2030-11-20T23:00:00Z", dtend_utc: "2030-11-21T02:00:00Z",
    }],
  };
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}`, () => ({ json: event }));
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}/ticketing`, () => ({ json: null }));
  await mockApi(page, next, (url) => url.pathname === "/api/clubs/7/payouts", () => ({ json: {
    paid_tickets_enabled: false, connected: false, charges_enabled: false, payouts_enabled: false,
    details_submitted: false, requirements_due: [], country: "CA", currency: "cad",
  } }));

  await page.goto(`/events/${EVENT_ID}`);
  await page.locator('[data-slot="event-actions"]').getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  const title = form.getByLabel(/Event Title/i);
  await title.fill("Board Games Night II");
  await page.getByTestId("save-bar").getByRole("button", { name: "Discard" }).click();
  await expect(title).toHaveValue("Board Games Night");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
});
