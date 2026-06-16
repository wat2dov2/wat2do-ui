import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://localhost:5173";
const API = "http://localhost:8000";

/** Shared test identity used across auth-seeded tests. */
const TEST_EMAIL = "test@uwaterloo.ca";

test.beforeEach(async ({ page }) => {
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("localhost:8000") && status >= 400) {
      console.log(`[API RESPONSE ERROR] ${response.request().method()} ${url} -> ${status}`);
    }
  });

  // Prevent CORS errors on active-ids by mocking it globally for all browser routes
  await page.route(new RegExp(`${API}/promotions/active-ids`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
});

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
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
        role: "admin",
      }),
    });
  });

  // Mock clubs/mine
  await page.route(`${API}/clubs/mine`, async (route) => {
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
        }
      ]),
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
        },
        {
          id: 3,
          club_name: "UW Computer Science Club",
          club_type: "Technology",
          description: "Computer science club",
          school: "University of Waterloo",
        }
      ]),
    });
  });

  // Mock integrations endpoints
  const platforms = ["whatsapp", "discord", "slack", "telegram", "linkedin", "facebook", "instagram"];
  for (const p of platforms) {
    await page.route(new RegExp(`${API}/clubs/\\d+/integrations/${p}`), async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            platform: p,
            connected: false,
            name: null,
            last_sync: null,
            metadata: null,
          }),
        });
      } else if (method === "POST" || method === "PUT") {
        const body = route.request().postDataJSON() || {};
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            platform: p,
            connected: true,
            name: body.name || "Mock Connection",
            last_sync: new Date().toISOString(),
            metadata: body.metadata || {},
          }),
        });
      } else if (method === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            platform: p,
            connected: false,
            name: null,
            last_sync: null,
            metadata: null,
          }),
        });
      }
    });

    await page.route(`${API}/clubs/integrations/${p}/options`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          servers: p === "discord" || p === "slack" ? [{ id: "srv-1", name: "UW Tech Club" }] : [],
          oauth_url: `https://example.com/oauth/${p}`,
        }),
      });
    });
  }

  // Mock saved clubs
  await page.route(`${API}/saved-clubs/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock credits
  await page.route(`${API}/credits/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 100 }),
    });
  });

  // Mock saved events
  await page.route(`${API}/saved-events/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock active promotions IDs
  await page.route(`${API}/promotions/active-ids`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  const profile = {
    id: "mock-user-id",
    faculty: "Mathematics",
    interests: [],
    isFirstYear: false,
    school: "University of Waterloo",
    role: "admin",
    hasClub: true,
    clubs: [
      {
        id: 1,
        club_name: "UW Tech Club",
      }
    ],
    clubId: 1,
    clubName: "UW Tech Club",
  };

  await page.addInitScript(({ keyEmail, email, keyProfile, profileObj }) => {
    window.localStorage.setItem(keyEmail, JSON.stringify(email));
    window.localStorage.setItem(keyProfile, JSON.stringify(profileObj));
  }, {
    keyEmail: STORAGE_KEYS.USER_EMAIL,
    email: TEST_EMAIL,
    keyProfile: STORAGE_KEYS.USER_PROFILE,
    profileObj: profile,
  });
}

async function seedQrData(
  page: Parameters<typeof test>[0]["page"],
  opts?: { withScans?: boolean },
) {
  const now = new Date().toISOString();
  const qrCodes = [
    {
      id: "qr-test-1",
      name: "Test Poster 1",
      description: "Test QR poster for E2E",
      destination_type: "custom-url",
      destination_id: "https://example.com",
      filters: null,
      created_at: now,
      created_by: TEST_EMAIL,
      is_active: true,
      image_url: null,
      latitude: 43.4723,
      longitude: -80.5449,
    },
  ];

  const scans = opts?.withScans
    ? [
        {
          id: "scan-1",
          qr_code_id: "qr-test-1",
          scanned_at: now,
          user_id: "user-1",
          session_id: "session-1",
          conversion_actions: [],
          user_agent: "Playwright",
        },
        {
          id: "scan-2",
          qr_code_id: "qr-test-1",
          scanned_at: now,
          user_id: "user-2",
          session_id: "session-2",
          conversion_actions: [],
          user_agent: "Playwright",
        },
      ]
    : [];

  // Mock API endpoints for QR code posters and scans
  await page.route(new RegExp(`${API}/qr/\\?`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: qrCodes,
        page: 1,
        total_pages: 1,
      }),
    });
  });

  await page.route(new RegExp(`${API}/qr/scans`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: scans,
        page: 1,
        total_pages: 1,
      }),
    });
  });

  await page.addInitScript(
    (data) => {
      window.localStorage.setItem("qrCodes", JSON.stringify(data.qrCodes));
      window.localStorage.setItem("qrCodeScans", JSON.stringify(data.scans));
    },
    { qrCodes, scans },
  );
}

// ── Workflow 1: Auth Page ─────────────────────────────────────────────

test.describe("Auth Page", () => {
  test("renders signup form by default", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator("h1")).toContainText("Discover");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
    await expect(page.getByText(/already have an account/i)).toBeVisible();
  });

  test("toggles between signup and login modes", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();

    await page.getByRole("button", { name: /sign in$/i }).click();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText(/don't have an account/i)).toBeVisible();

    await page.getByRole("button", { name: /create one/i }).click();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("submit button is disabled until form is valid", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const submit = page.getByRole("button", { name: /create account/i });

    await expect(submit).toBeDisabled();

    await page.locator('input[type="email"]').fill("not-valid-email");
    await expect(submit).toBeDisabled();

    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await expect(submit).toBeEnabled();
  });

  test("shows error on invalid signup attempt", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill("bad@example.com");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator(".text-destructive")).toBeVisible({ timeout: 10000 });
  });
});

// ── Workflow 7: Posters & QR Analytics ─────────────────────────────────

test.describe("Posters & QR Analytics", () => {
  test("marketing, admin posters, and club posters share QR data", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await seedQrData(page, { withScans: true });

    // Marketing page: shows QR cards
    await page.goto(`${BASE}/marketing`);
    await expect(page.getByRole("heading", { name: "Marketing" })).toBeVisible();
    await expect(page.getByText("Test Poster 1")).toBeVisible();

    // Admin posters page: shows same QR code data
    await page.goto(`${BASE}/admin/posters`);
    await expect(page.getByText("Test Poster 1").first()).toBeVisible();

    // Organization panel posters page reuses same posters view
    await page.goto(`${BASE}/organization-panel/posters`);
    await expect(page.getByText("Test Poster 1").first()).toBeVisible();
  });
});

// ── Workflow 8: Club Integrations ──────────────────────────────────────

test.describe("Club Integrations", () => {
  test("can connect WhatsApp integration end to end", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/organization-panel/integrations`);

    // WhatsApp card
    const whatsappCard = page
      .locator("div.bg-card", { hasText: "WhatsApp" })
      .first();

    await expect(whatsappCard.getByRole("heading", { name: "WhatsApp" })).toBeVisible();
    await whatsappCard.getByRole("button", { name: "Connect" }).click();

    // WhatsApp modal
    await expect(page.getByRole("heading", { name: "Connect WhatsApp" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // Card shows connected state and last sync
    await expect(
      whatsappCard.getByText("Connected", { exact: false }),
    ).toBeVisible();
    await expect(
      whatsappCard.getByText("Last sync", { exact: false }),
    ).toBeVisible();
  });

  test("can connect Discord integration with channel selection", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/organization-panel/integrations`);

    const discordCard = page
      .locator("div.bg-card", { hasText: "Discord" })
      .first();

    await expect(discordCard.getByRole("heading", { name: "Discord" })).toBeVisible();
    await discordCard.getByRole("button", { name: "Connect" }).click();

    // Step 1: add bot — clicking immediately transitions to step 2
    await expect(page.getByRole("heading", { name: "Connect Discord" })).toBeVisible();
    await page.getByRole("button", { name: "Add to Discord" }).click();


    // Step 2: select server and channel (handleAddBot transitions instantly)
    const dialog = page.getByRole("dialog", { name: "Connect Discord" });
    await expect(dialog.getByRole("combobox")).toBeVisible();

    // Activate button should be disabled until server + channel are selected
    await expect(dialog.getByRole("button", { name: "Activate" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});

// ── Workflow 2: Home / Events Page ────────────────────────────────────

test.describe("Events Page", () => {
  test("loads and displays events", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/events-page.png", fullPage: true });
  });

  test("backend API returns events", async ({ request }) => {
    const res = await request.get(`${API}/events/`);
    expect(res.status()).toBe(200);
    const events = await res.json();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty("title");
    expect(events[0]).toHaveProperty("location");
    expect(events[0]).toHaveProperty("id");
  });

  test("backend events match expected seed data", async ({ request }) => {
    const res = await request.get(`${API}/events/`);
    const events = await res.json();
    const titles = events.map((e: { title: string }) => e.title);
    expect(titles).toContain("Tech Career Fair");
    expect(titles).toContain("Board Game Night");
    expect(titles).toContain("UWMUN Events");
  });

  test("event search filter works on API", async ({ request }) => {
    const res = await request.get(`${API}/events/?search=career`);
    expect(res.status()).toBe(200);
    const events = await res.json();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.map((e: { title: string }) => e.title)).toContain("Tech Career Fair");
  });

  test("event category filter works on API", async ({ request }) => {
    const res = await request.get(`${API}/events/?category=Career`);
    expect(res.status()).toBe(200);
    const events = await res.json();
    expect(events.every((e: { category: string }) => e.category === "Career")).toBeTruthy();
  });
});

// ── Workflow 3: Clubs Page ────────────────────────────────────────────

test.describe("Organizations Page", () => {
  test("loads and displays organizations", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/organizations-page.png", fullPage: true });
  });

  test("backend API returns clubs", async ({ request }) => {
    const res = await request.get(`${API}/clubs/`);
    expect(res.status()).toBe(200);
    const clubs = await res.json();
    expect(clubs.length).toBeGreaterThan(0);
    expect(clubs[0]).toHaveProperty("club_name");
    expect(clubs[0]).toHaveProperty("club_type");
  });

  test("backend clubs match expected seed data", async ({ request }) => {
    const res = await request.get(`${API}/clubs/`);
    const clubs = await res.json();
    const names = clubs.map((c: { club_name: string }) => c.club_name);
    expect(names).toContain("UW Board Games Club");
    expect(names).toContain("UW Computer Science Club");
  });

  test("club search filter works on API", async ({ request }) => {
    const res = await request.get(`${API}/clubs/?search=computer`);
    expect(res.status()).toBe(200);
    const clubs = await res.json();
    expect(clubs.length).toBeGreaterThanOrEqual(1);
    expect(clubs.map((c: { club_name: string }) => c.club_name)).toContain("UW Computer Science Club");
  });
});

// ── Workflow 4: Onboarding Page ───────────────────────────────────────

test.describe("Onboarding Page", () => {
  test("renders onboarding steps", async ({ page }) => {
    await page.goto(`${BASE}/onboarding`);
    await page.waitForTimeout(1000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/onboarding-page.png", fullPage: true });
  });
});

// ── Workflow 5: Auth-protected endpoints ──────────────────────────────

test.describe("Auth-protected API endpoints", () => {
  test("POST /events/ requires authentication", async ({ request }) => {
    const res = await request.post(`${API}/events/`, {
      data: { title: "Test", location: "Test" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("POST /clubs/ requires authentication", async ({ request }) => {
    const res = await request.post(`${API}/clubs/`, {
      data: { club_name: "Test", club_type: "Test" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("GET /users/me requires authentication", async ({ request }) => {
    const res = await request.get(`${API}/users/me`);
    expect([401, 403]).toContain(res.status());
  });

  test("PATCH /users/me/profile requires authentication", async ({ request }) => {
    const res = await request.patch(`${API}/users/me/profile`, {
      data: { faculty: "Engineering" },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ── Workflow 6: Navigation ────────────────────────────────────────────

test.describe("Navigation", () => {
  test("main pages load without errors", async ({ page }) => {
    const routes = ["/", "/login", "/onboarding", "/organizations", "/about", "/settings"];
    for (const route of routes) {
      const res = await page.goto(`${BASE}${route}`);
      expect(res?.status()).toBe(200);
    }
  });

  test("no console errors on events page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("Failed to load resource"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
