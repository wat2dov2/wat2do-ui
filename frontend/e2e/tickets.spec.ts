import { expect, test, type Page, type Route } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE_URL = "http://127.0.0.1:3000";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const CODE = "7KQ2MZ4PABCDEFGHIJKLMNOP";
const DATE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const STARTS = new Date(Date.now() + 3 * 86_400_000).toISOString();

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    status: "valid",
    checked_in_at: null,
    event_id: 9,
    event_title: "Charity Gala",
    event_date_id: DATE_ID,
    dtstart_utc: STARTS,
    dtend_utc: null,
    location: "SLC Great Hall",
    club_id: 7,
    club_name: "Gala Club",
    school: "uwaterloo",
    image_url: null,
    holder_name: "Sam K.",
    can_check_in: false,
    ...overrides,
  };
}

/** A signed-in student, restored from the cached profile like a returning visitor. */
async function signIn(page: Page): Promise<void> {
  const now = new Date().toISOString();
  await page.route(
    (url) => apiPath(url) === "/auth/refresh",
    (route) =>
      fulfillJson(route, {
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        user_id: USER_ID,
        school: "uwaterloo",
        onboarding_required: false,
      }),
  );
  await page.route(
    (url) => apiPath(url) === "/users/me",
    (route) =>
      fulfillJson(route, {
        id: USER_ID,
        email: "sam@uwaterloo.ca",
        full_name: "Sam Kim",
        avatar_url: null,
        faculty: null,
        school: "uwaterloo",
        interests: [],
        is_first_year: false,
        role: "user",
        payout_email: null,
        promoter_tos_accepted_at: null,
        promoter_tos_version: null,
        created_at: now,
        updated_at: now,
      }),
  );
  await page.route((url) => apiPath(url) === "/clubs/mine", (route) => fulfillJson(route, []));
  await page.route((url) => apiPath(url) === "/going-events", (route) => fulfillJson(route, []));
  await page.addInitScript(
    ({ emailKey, profileKey }) => {
      window.localStorage.setItem(emailKey, JSON.stringify("sam@uwaterloo.ca"));
      window.localStorage.setItem(
        profileKey,
        JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          fullName: "Sam Kim",
          avatarUrl: null,
          school: "uwaterloo",
          role: "user",
          hasClub: false,
          clubs: [],
          clubId: null,
          clubName: null,
        }),
      );
    },
    { emailKey: STORAGE_KEYS.USER_EMAIL, profileKey: STORAGE_KEYS.USER_PROFILE },
  );
}

test.describe("Tickets", () => {
  test("my tickets lists each ticket and opens its scannable pass", async ({ page }) => {
    await signIn(page);
    await page.route((url) => apiPath(url) === "/tickets/mine", (route) => fulfillJson(route, [ticket()]));
    await page.route((url) => apiPath(url) === `/tickets/${CODE}`, (route) => fulfillJson(route, ticket()));

    await page.goto(`${BASE_URL}/tickets`);
    await expect(page.getByRole("heading", { name: "My tickets" })).toBeVisible();
    await page.getByRole("link", { name: /Charity Gala/ }).click();

    await expect(page).toHaveURL(`${BASE_URL}/tickets/${CODE}`);
    await expect(page.getByRole("img", { name: "QR code for this ticket" })).toBeVisible();
    await expect(page.getByText("Show this QR code at the door.")).toBeVisible();
    await expect(page.getByText("7KQ2 MZ4P ABCD EFGH IJKL MNOP")).toBeVisible();
  });

  test("a club officer admits a ticket straight from its link", async ({ page }) => {
    let admitted = false;
    await page.route(
      (url) => apiPath(url) === `/tickets/${CODE}`,
      (route) =>
        fulfillJson(
          route,
          ticket({ can_check_in: true, checked_in_at: admitted ? new Date().toISOString() : null }),
        ),
    );
    await page.route(
      (url) => apiPath(url) === `/events/9/ticketing/check-ins/${CODE}`,
      async (route) => {
        expect(route.request().method()).toBe("PUT");
        expect(route.request().postDataJSON()).toEqual({ checked_in: true });
        admitted = true;
        await fulfillJson(route, { result: "checked_in", attendee: null });
      },
    );

    await page.goto(`${BASE_URL}/tickets/${CODE}`);
    await page.getByRole("button", { name: "Check in" }).click();

    await expect(page.getByText(/^Checked in at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo check-in" })).toBeVisible();
  });

  test("the order page waits for Stripe's confirmation, then shows the tickets", async ({ page }) => {
    await signIn(page);
    let polls = 0;
    await page.route(
      (url) => apiPath(url) === `/tickets/orders/${ORDER_ID}`,
      (route) =>
        fulfillJson(route, {
          id: ORDER_ID,
          status: ++polls < 2 ? "pending" : "paid",
          event_id: 9,
          quantity: 1,
          unit_amount_cents: 1500,
          currency: "cad",
          tickets: polls < 2 ? [] : [ticket()],
        }),
    );

    await page.goto(`${BASE_URL}/tickets/orders/${ORDER_ID}`);
    await expect(page.getByText("Confirming your payment")).toBeVisible();
    await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code for this ticket" })).toBeVisible();
  });
});
