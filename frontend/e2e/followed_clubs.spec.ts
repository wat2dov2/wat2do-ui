import { test, expect, type Page } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://127.0.0.1:3000";

const TEST_EMAIL = "test@uwaterloo.ca";

const MOCK_CLUBS = [
  {
    id: 1,
    club_name: "UW Tech Club",
    club_type: "independent",
    club_page: "https://example.com/tech",
    ig: null,
    discord: null,
    logo_url: null,
    created_by: "owner-user-id",
    description: "A test club",
    school: "uwaterloo",
    categories: ["Technology"],
    event_count: 1,
  },
  {
    id: 2,
    club_name: "UW Board Games Club",
    club_type: "independent",
    club_page: "https://example.com/board-games",
    ig: null,
    discord: null,
    logo_url: null,
    created_by: "owner-user-id",
    description: "Board games club",
    school: "uwaterloo",
    categories: ["Social"],
    event_count: 1,
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function selectClubScope(
  page: Page,
  label: string,
) {
  await page.getByRole("combobox", { name: /all|followed|claimed/i }).click();
  await page.getByRole("option", { name: label }).click();
}

async function seedAuthenticatedSession(
  page: Page,
) {
  // In-memory array to track mock saved club IDs across mock routes
  let savedIds: number[] = [];

  // Mock auth refresh
  await page.route(
    (url) => apiPath(url) === "/auth/refresh",
    async (route) => {
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
    },
  );

  // Mock users/me
  await page.route(
    (url) => apiPath(url) === "/users/me",
    async (route) => {
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
    },
  );

  // Mock clubs/mine (empty)
  await page.route(
    (url) => apiPath(url) === "/clubs/mine",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    },
  );

  // Mock GET /clubs/ list
  await page.route(
    (url) => apiPath(url) === "/clubs",
    async (route) => {
      const requestUrl = new URL(route.request().url());
      const idsParam = requestUrl.searchParams.getAll("ids");

      let items = MOCK_CLUBS;
      if (requestUrl.searchParams.has("ids")) {
        const ids = idsParam.map(Number);
        items = MOCK_CLUBS.filter((item) => ids.includes(item.id));
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          total: items.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
        }),
      });
    },
  );

  await page.route(
    (url) => /^\/clubs\/\d+$/.test(apiPath(url) ?? ""),
    async (route) => {
      const clubId = Number(
        apiPath(new URL(route.request().url()))?.split("/").pop(),
      );
      const club = MOCK_CLUBS.find(
        (item) => item.id === clubId,
      );
      await route.fulfill({
        status: club ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(club ?? { detail: "Not found" }),
      });
    },
  );

  // Mock GET/PUT/DELETE /saved-clubs/
  await page.route(
    (url) => apiPath(url)?.startsWith("/saved-clubs") === true,
    async (route) => {
      const requestUrl = new URL(route.request().url());
      const method = route.request().method();
      const pathname = requestUrl.pathname;
      const match = pathname.match(/\/saved-clubs\/(\d+)/);

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
          savedIds = savedIds.filter((id) => id !== orgId);
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
    },
  );

  // Mock GET /credits/
  await page.route(
    (url) => apiPath(url) === "/credits",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: 0 }),
      });
    },
  );

  // Mock GET /going-events/
  await page.route(
    (url) => apiPath(url) === "/going-events",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    },
  );

  // Mock GET /events/ (the club page lists its host's upcoming events)
  await page.route(
    (url) => apiPath(url) === "/events",
    async (route) => {
      const requestUrl = new URL(route.request().url());
      const matchesClubId =
        requestUrl.searchParams.get("club_ids") === "1";
      const startsAt = new Date(Date.now() + 86_400_000).toISOString();
      const items = matchesClubId
        ? [
            {
              id: 41,
              title: "Tech Career Fair",
              location: "SLC",
              occurrences: [
                {
                  id: "11111111-1111-1111-1111-111111111111",
                  event_id: 41,
                  dtstart_utc: startsAt,
                  dtend_utc: null,
                },
              ],
              price: 0,
              food: [],
              registration: false,
              source_image_url: null,
              category: "Career",
              club: "legacy-wloo-tech-handle",
              club_type: "independent",
              club_id: 1,
              school: "uwaterloo",
              added_at: new Date().toISOString(),
            },
          ]
        : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          total: items.length,
          page: 1,
          page_size: 50,
          total_pages: items.length ? 1 : 0,
          latest_added_event: null,
        }),
      });
    },
  );

  // Mock GET /events/stats
  await page.route(
    (url) => apiPath(url) === "/events/stats",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    },
  );

  // Seed localStorage hint
  await page.addInitScript(
    ({ key, email }) => {
      window.localStorage.setItem(key, JSON.stringify(email));
    },
    { key: STORAGE_KEYS.USER_EMAIL, email: TEST_EMAIL },
  );
}

test.describe("Followed Clubs Flow", () => {
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
    });

    await page.route(
      (url) => apiPath(url) === "/meta/constants",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            event_categories: ["Career", "Technology"],
            club_categories: ["Technology", "Social"],
            interests: ["Career", "Technology"],
            interest_to_categories: {
              Career: ["Career"],
              Technology: ["Technology"],
            },
            report_statuses: ["pending", "resolved", "dismissed"],
          }),
        });
      },
    );

    await page.route(
      (url) => apiPath(url) === "/promotions/active-ids",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await page.route(
      (url) => apiPath(url) === "/going-events",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await page.route(
      (url) => apiPath(url) === "/saved-clubs",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await page.route(
      (url) => apiPath(url) === "/credits",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ balance: 0 }),
        });
      },
    );

    await page.route(
      (url) => apiPath(url) === "/clubs",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: MOCK_CLUBS,
            total: MOCK_CLUBS.length,
            page: 1,
            page_size: 20,
            total_pages: 1,
          }),
        });
      },
    );
  });

  test("unauthenticated user sees Sign In CTA on followed tab", async ({
    page,
  }) => {
    await page.goto(`${BASE}/clubs`);
    await page.waitForTimeout(1000);

    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();
    await selectClubScope(page, "Followed");

    // Assert that the Sign In CTA is displayed
    await expect(
      page.getByRole("heading", {
        name: "Sign in to view followed clubs",
      }),
    ).toBeVisible();
    await expect(page.locator("#followed-clubs-sign-in")).toBeVisible();
  });

  test("unauthenticated user sees Sign In CTA on claimed tab", async ({
    page,
  }) => {
    await page.goto(`${BASE}/clubs`);
    await page.waitForTimeout(1000);

    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();
    await selectClubScope(page, "Claimed");

    // Assert that the Sign In CTA is displayed
    await expect(
      page.getByRole("heading", {
        name: "Sign in to view claimed clubs",
      }),
    ).toBeVisible();
    await expect(page.locator("#claimed-clubs-sign-in")).toBeVisible();
  });

  test("shows club events and positions in tabs", async ({ page }) => {
    await page.route(
      (url) => apiPath(url) === "/clubs/1",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_CLUBS[0]),
        });
      },
    );
    await page.route(
      (url) => apiPath(url) === "/events",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            total: 0,
            page: 1,
            page_size: 50,
            total_pages: 0,
            latest_added_event: null,
          }),
        });
      },
    );
    await page.route(
      (url) => apiPath(url) === "/positions",
      async (route) => {
        const requestUrl = new URL(route.request().url());
        const items =
          requestUrl.searchParams.get("club_id") === "1"
            ? [
                {
                  id: 91,
                  club_id: 1,
                  title: "Design Lead",
                  description: "Lead the visual direction for club campaigns.",
                  position_type: "committee",
                  requirements: ["Portfolio"],
                  commitment: "3 hours per week",
                  compensation: "Volunteer",
                  location: "Hybrid",
                  contact_email: "design@example.com",
                  deadline_date: "2026-08-21",
                  deadline_at: null,
                  source_url: "https://instagram.com/p/design/",
                  source_image_url: null,
                  ingestion_source: "seed",
                  is_active: true,
                  added_at: "2026-08-01T12:00:00Z",
                  updated_at: "2026-08-01T12:00:00Z",
                  club_name: "UW Tech Club",
                  club_logo_url: null,
                  club_type: "independent",
                  club_page: "https://example.com/tech",
                  club_ig: null,
                  club_discord: null,
                  school: "uwaterloo",
                },
              ]
            : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items,
            total: items.length,
            page: 1,
            page_size: 50,
            total_pages: items.length ? 1 : 0,
          }),
        });
      },
    );

    await page.goto(`${BASE}/clubs`);
    await page.getByText("UW Tech Club", { exact: true }).click();

    const title = page.locator('[data-slot="page-header-title"]');
    const signInToJoin = page.getByRole("button", {
      name: "Sign In to Join",
    });
    await expect(title).toHaveText("UW Tech Club");
    await expect(signInToJoin).toBeVisible();
    await expect(page.getByRole("tab", { name: "Events" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByRole("tab", { name: "Positions" }).click();
    await expect(page.getByText("Design Lead", { exact: true })).toBeVisible();
    await expect(page.getByText("Due Aug 21", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        title.evaluate((titleElement) => {
          const header = titleElement.closest('[data-slot="page-header"]');
          const actions = header?.querySelector(
            '[data-slot="page-header-actions"]',
          );
          const headingRow = actions?.parentElement;
          return {
            sameRow: Boolean(headingRow?.contains(titleElement)),
            justification: headingRow
              ? getComputedStyle(headingRow).justifyContent
              : null,
          };
        }),
      )
      .toEqual({ sameRow: true, justification: "space-between" });
  });

  test("authenticated user toggles club follow status", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/clubs`);
    await page.waitForTimeout(2000);

    // Assert that we are on All Clubs tab and cards are loaded
    await expect(page.getByRole("combobox", { name: "All" })).toBeVisible();

    // Switch to Followed Clubs tab, should show empty state
    await selectClubScope(page, "Followed");
    await expect(page.getByText("No followed clubs")).toBeVisible();

    // Switch back to All Clubs
    await selectClubScope(page, "All");

    // Open the dedicated details page for the first club.
    await page.getByText("UW Tech Club").click();
    await expect(page).toHaveURL(`${BASE}/clubs/1`);
    await expect(page.getByText("Tech Career Fair")).toBeVisible();

    const firstFollowBtn = page.getByRole("button", {
      name: "Follow club",
    });
    await expect(firstFollowBtn).toBeVisible();
    await firstFollowBtn.click();

    await page.getByRole("link", { name: "All clubs" }).click();

    // Wait a brief moment for optimistic update/backend sync
    await page.waitForTimeout(500);

    // Switch to Followed Clubs tab, now the followed card should be there
    await selectClubScope(page, "Followed");
    await expect(page.getByText("No followed clubs")).not.toBeVisible();
    await expect(page.getByText("UW Tech Club")).toBeVisible();

    // Unfollow from the followed tab
    await page.getByText("UW Tech Club").click();
    await expect(page).toHaveURL(`${BASE}/clubs/1`);

    const unfollowBtn = page.getByRole("button", {
      name: "Followed club",
    });
    await expect(unfollowBtn).toBeVisible();
    await unfollowBtn.click();

    await page.getByRole("link", { name: "All clubs" }).click();

    // Wait a brief moment
    await page.waitForTimeout(500);

    // Assert empty state is shown again
    await selectClubScope(page, "Followed");
    await expect(page.getByText("No followed clubs")).toBeVisible();
  });
});
