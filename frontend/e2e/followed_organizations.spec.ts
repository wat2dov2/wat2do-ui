import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://127.0.0.1:3000";

const TEST_EMAIL = "test@uwaterloo.ca";

const MOCK_ORGANIZATIONS = [
  {
    id: 1,
    organization_name: "UW Tech Club",
    organization_type: "Technology",
    organization_page: "https://example.com/tech",
    ig: null,
    discord: null,
    logo_url: null,
    created_by: "owner-user-id",
    description: "A test organization",
    school: "uwaterloo",
    categories: ["Technology"],
    event_count: 1,
    latest_event_title: "Tech Career Fair",
    latest_event_added_at: new Date().toISOString(),
  },
  {
    id: 2,
    organization_name: "UW Board Games Club",
    organization_type: "Social",
    organization_page: "https://example.com/board-games",
    ig: null,
    discord: null,
    logo_url: null,
    created_by: "owner-user-id",
    description: "Board games organization",
    school: "uwaterloo",
    categories: ["Social"],
    event_count: 1,
    latest_event_title: "Board Game Night",
    latest_event_added_at: new Date().toISOString(),
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function selectOrganizationScope(page: Parameters<typeof test>[0]["page"], label: string) {
  await page.getByRole("combobox", { name: /all|followed|claimed/i }).click();
  await page.getByRole("option", { name: label }).click();
}

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
  // In-memory array to track mock saved organization IDs across mock routes
  let savedIds: number[] = [];

  // Mock auth refresh
  await page.route(url => apiPath(url) === "/auth/refresh", async (route) => {
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
  await page.route(url => apiPath(url) === "/users/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "mock-user-id",
        email: TEST_EMAIL,
        school: "uwaterloo",
        faculty: "Mathematics",
        interests: [],
        is_first_year: false,
        role: "user",
      }),
    });
  });

  // Mock organizations/mine (empty)
  await page.route(url => apiPath(url) === "/organizations/mine", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(url => apiPath(url) === "/organizations/1/membership", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    });
  });

  // Mock GET /organizations/ list
  await page.route(url => apiPath(url) === "/organizations", async (route) => {
    const requestUrl = new URL(route.request().url());
    const idsParam = requestUrl.searchParams.getAll("ids");

    let items = MOCK_ORGANIZATIONS;
    if (requestUrl.searchParams.has("ids")) {
      const ids = idsParam.map(Number);
      items = MOCK_ORGANIZATIONS.filter(item => ids.includes(item.id));
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
  await page.route(url => apiPath(url)?.startsWith("/saved-organizations") === true, async (route) => {
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
  await page.route(url => apiPath(url) === "/credits", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 0 }),
    });
  });

  // Mock GET /going-events/
  await page.route(url => apiPath(url) === "/going-events", async (route) => {
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
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
    });

    await page.route(url => apiPath(url) === "/meta/constants", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event_categories: ["Career", "Technology"],
          organization_categories: ["Technology", "Social"],
          interests: ["Career", "Technology"],
          interest_to_categories: {
            Career: ["Career"],
            Technology: ["Technology"],
          },
          report_statuses: ["pending", "resolved", "dismissed"],
        }),
      });
    });

    await page.route(url => apiPath(url) === "/promotions/active-ids", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(url => apiPath(url) === "/going-events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(url => apiPath(url) === "/saved-organizations", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(url => apiPath(url) === "/credits", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: 0 }),
      });
    });

    await page.route(url => apiPath(url) === "/organizations", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: MOCK_ORGANIZATIONS,
          total: MOCK_ORGANIZATIONS.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        }),
      });
    });
  });

  test("unauthenticated user sees Sign In CTA on followed tab", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(1000);

    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();
    await selectOrganizationScope(page, "Followed");

    // Assert that the Sign In CTA is displayed
    await expect(page.getByRole("heading", { name: "Sign in to view followed organizations" })).toBeVisible();
    await expect(page.locator("#followed-clubs-sign-in")).toBeVisible();
  });

  test("unauthenticated user sees Sign In CTA on claimed tab", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(1000);

    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();
    await selectOrganizationScope(page, "Claimed");

    // Assert that the Sign In CTA is displayed
    await expect(page.getByRole("heading", { name: "Sign in to view claimed organizations" })).toBeVisible();
    await expect(page.locator("#claimed-clubs-sign-in")).toBeVisible();
  });

  test("authenticated user toggles club follow status", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(2000);

    // Assert that we are on All Clubs tab and cards are loaded
    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();
    
    // Switch to Followed Clubs tab, should show empty state
    await selectOrganizationScope(page, "Followed");
    await expect(page.getByText("No followed organizations")).toBeVisible();

    // Switch back to All Clubs
    await selectOrganizationScope(page, "All");

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
    await selectOrganizationScope(page, "Followed");
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
