import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://localhost:5173";
const API = "http://localhost:8000";

const TEST_EMAIL = "test@uwaterloo.ca";

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
  // In-memory array to track mock saved club IDs across mock routes
  let savedIds: number[] = [];

  // Mock auth refresh
  await page.route(`${API}/auth/refresh`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        user_id: "mock-user-id",
      }),
    });
  });

  // Mock users/me
  await page.route(`${API}/users/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "mock-user-id",
        email: TEST_EMAIL,
        school: "University of Waterloo",
        faculty: "Mathematics",
        interests: [],
        is_first_year: false,
        role: "user",
      }),
    });
  });

  // Mock clubs/mine (empty)
  await page.route(`${API}/clubs/mine`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock GET /clubs/ list
  await page.route(new RegExp(`${API}/clubs/(\\?|$)`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1,
          club_name: "UW Tech Club",
          club_type: "Technology",
          description: "A test club",
          school: "University of Waterloo",
        },
        {
          id: 2,
          club_name: "UW Board Games Club",
          club_type: "Social",
          description: "Board games club",
          school: "University of Waterloo",
        }
      ]),
    });
  });

  // Mock GET /saved-clubs/
  await page.route(`${API}/saved-clubs/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedIds),
    });
  });

  // Mock GET /credits/
  await page.route(`${API}/credits/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 0 }),
    });
  });

  // Mock GET /saved-events/
  await page.route(`${API}/saved-events/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock PUT / saved-clubs/club_id and DELETE /saved-clubs/club_id
  await page.route(new RegExp(`${API}/saved-clubs/\\d+`), async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const match = url.match(/\/saved-clubs\/(\d+)/);
    const clubId = match ? parseInt(match[1]) : 0;

    if (method === "PUT") {
      if (!savedIds.includes(clubId)) {
        savedIds.push(clubId);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "saved" }),
      });
    } else if (method === "DELETE") {
      savedIds = savedIds.filter(id => id !== clubId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "unsaved" }),
      });
    } else {
      await route.continue();
    }
  });

  // Seed localStorage hint
  await page.addInitScript(({ key, email }) => {
    window.localStorage.setItem(key, JSON.stringify(email));
  }, { key: STORAGE_KEYS.USER_EMAIL, email: TEST_EMAIL });
}

test.describe("Followed Organizations Flow", () => {
  test.beforeEach(({ page }) => {
    page.on("console", (msg) => {
      console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
    });
  });

  test("unauthenticated user sees Sign In CTA on followed tab", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(1000);

    // Assert that we are on the clubs page
    await expect(page.locator("#tab-all-clubs")).toBeVisible();
    await expect(page.locator("#tab-followed-clubs")).toBeVisible();

    // Click on Followed Clubs tab
    await page.locator("#tab-followed-clubs").click();

    // Assert that the Sign In CTA is displayed
    await expect(page.getByRole("heading", { name: "Sign in to view followed organizations" })).toBeVisible();
    await expect(page.locator("#followed-clubs-sign-in")).toBeVisible();
  });

  test("authenticated user toggles club follow status", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(2000);

    // Assert that we are on All Clubs tab and cards are loaded
    await expect(page.locator("#tab-all-clubs")).toBeVisible();
    
    // Switch to Followed Clubs tab, should show empty state
    await page.locator("#tab-followed-clubs").click();
    await expect(page.getByText("No followed organizations")).toBeVisible();

    // Switch back to All Clubs
    await page.locator("#tab-all-clubs").click();

    // Find the first club follow button and click it
    const firstFollowBtn = page.locator("[id^=follow-club-]").first();
    await expect(firstFollowBtn).toBeVisible();
    await firstFollowBtn.click();

    // Wait a brief moment for optimistic update/backend sync
    await page.waitForTimeout(500);

    // Switch to Followed Clubs tab, now the followed card should be there
    await page.locator("#tab-followed-clubs").click();
    await expect(page.getByText("No followed organizations")).not.toBeVisible();
    
    const displayClubsCount = await page.locator("article").count();
    expect(displayClubsCount).toBe(1);

    // Unfollow from the followed tab
    const unfollowBtn = page.locator("[id^=follow-club-]").first();
    await unfollowBtn.click();

    // Wait a brief moment
    await page.waitForTimeout(500);

    // Assert empty state is shown again
    await expect(page.getByText("No followed organizations")).toBeVisible();
  });
});
