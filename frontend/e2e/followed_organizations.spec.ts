import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://localhost:5173";

const TEST_EMAIL = "test@uwaterloo.ca";

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
  // In-memory array to track mock saved organization IDs across mock routes
  let savedIds: number[] = [];

  // Mock auth refresh
  await page.route((url) => url.pathname.includes("/auth/refresh") && url.port === "8000", async (route) => {
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
  await page.route((url) => url.pathname.includes("/users/me") && url.port === "8000", async (route) => {
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

  // Mock organizations/mine (empty)
  await page.route((url) => url.pathname === "/organizations/mine" && url.port === "8000", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock GET /organizations/ list
  await page.route((url) => (url.pathname === "/organizations" || url.pathname === "/organizations/") && url.port === "8000", async (route) => {
    const requestUrl = new URL(route.request().url());
    const idsParam = requestUrl.searchParams.getAll("ids");

    const allItems = [
      {
        id: 1,
        organization_name: "UW Tech Club",
        organization_type: "Technology",
        description: "A test club",
        school: "University of Waterloo",
        categories: ["Technology"],
      },
      {
        id: 2,
        organization_name: "UW Board Games Club",
        organization_type: "Social",
        description: "Board games club",
        school: "University of Waterloo",
        categories: ["Social"],
      }
    ];

    let items = allItems;
    if (requestUrl.searchParams.has("ids")) {
      const ids = idsParam.map(Number);
      items = allItems.filter(item => ids.includes(item.id));
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        total: items.length,
        page: 1,
        page_size: 20,
        total_pages: 1
      }),
    });
  });

  // Mock GET/PUT/DELETE /saved-organizations/
  await page.route((url) => url.pathname.includes("/saved-organizations") && url.port === "8000", async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();
    const pathname = requestUrl.pathname;
    const match = pathname.match(/\/saved-organizations\/(\d+)/);

    if (match) {
      const orgId = parseInt(match[1]);
      if (method === "PUT") {
        if (!savedIds.includes(orgId)) {
          savedIds.push(orgId);
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "saved" }),
        });
      } else if (method === "DELETE") {
        savedIds = savedIds.filter(id => id !== orgId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "unsaved" }),
        });
      } else {
        await route.continue();
      }
    } else {
      // GET list
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedIds),
      });
    }
  });

  // Mock GET /credits/
  await page.route((url) => url.pathname.includes("/credits") && url.port === "8000", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 0 }),
    });
  });

  // Mock GET /saved-events/
  await page.route((url) => url.pathname.includes("/saved-events") && url.port === "8000", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
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
    await expect(page.locator("#tab-claimed-clubs")).toBeVisible();

    // Click on Followed Clubs tab
    await page.locator("#tab-followed-clubs").click();

    // Assert that the Sign In CTA is displayed
    await expect(page.getByRole("heading", { name: "Sign in to view followed organizations" })).toBeVisible();
    await expect(page.locator("#followed-clubs-sign-in")).toBeVisible();
  });

  test("unauthenticated user sees Sign In CTA on claimed tab", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(1000);

    // Assert that we are on the clubs page
    await expect(page.locator("#tab-all-clubs")).toBeVisible();
    await expect(page.locator("#tab-followed-clubs")).toBeVisible();
    await expect(page.locator("#tab-claimed-clubs")).toBeVisible();

    // Click on Claimed Clubs tab
    await page.locator("#tab-claimed-clubs").click();

    // Assert that the Sign In CTA is displayed
    await expect(page.getByRole("heading", { name: "Sign in to view claimed organizations" })).toBeVisible();
    await expect(page.locator("#claimed-clubs-sign-in")).toBeVisible();
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

    // Open detail modal for first club
    await page.getByText("UW Tech Club").click();

    // Find follow button in details modal and click it
    const firstFollowBtn = page.locator('button[title="Follow organization"]');
    await expect(firstFollowBtn).toBeVisible();
    await firstFollowBtn.click();

    // Close the details modal
    await page.keyboard.press("Escape");

    // Wait a brief moment for optimistic update/backend sync
    await page.waitForTimeout(500);

    // Switch to Followed Clubs tab, now the followed card should be there
    await page.locator("#tab-followed-clubs").click();
    await expect(page.getByText("No followed organizations")).not.toBeVisible();
    await expect(page.getByText("UW Tech Club")).toBeVisible();

    // Unfollow from the followed tab
    await page.getByText("UW Tech Club").click();
    
    const unfollowBtn = page.locator('button[title="Followed organization"]');
    await expect(unfollowBtn).toBeVisible();
    await unfollowBtn.click();

    // Close the details modal
    await page.keyboard.press("Escape");

    // Wait a brief moment
    await page.waitForTimeout(500);

    // Assert empty state is shown again
    await expect(page.getByText("No followed organizations")).toBeVisible();
  });
});
