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
  await page.getByRole("button", { name: "Give it back" }).click();
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

test("the door scanner checks in a typed code and says so at a glance", async ({ page, next }) => {
  await signIn(page, next, [{ id: 7, club_name: "Board Game Club", school: "uwaterloo" }]);
  await mockApi(page, next, (url) => url.pathname === `/api/events/${EVENT_ID}/ticketing/desk`, () => ({
    json: {
      ticketing: {
        event_id: EVENT_ID,
        price_cents: 0,
        currency: null,
        capacity: 40,
        paused: false,
        available: true,
        maximum_per_order: 1,
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
  await page.getByRole("textbox", { name: "Ticket code" }).fill("7kq2 mz4p abcd efgh ijkl mnop");
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Already checked in")).toBeVisible();
});
