import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://127.0.0.1:3000";
const APP_API = `${BASE}/api`;

/** Shared test identity used across auth-seeded tests. */
const TEST_EMAIL = "test@uwaterloo.ca";

const MOCK_ORGANIZATIONS = [
  {
    id: 1,
    organization_name: "UW Tech Club",
    organization_type: "Technology",
    organization_page: "https://example.com/tech",
    description: "A test organization",
    school: "University of Waterloo",
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
    description: "Board games organization",
    school: "University of Waterloo",
    categories: ["Social"],
    event_count: 1,
    latest_event_title: "Board Game Night",
    latest_event_added_at: new Date().toISOString(),
  },
  {
    id: 3,
    organization_name: "UW Computer Science Club",
    organization_type: "Technology",
    organization_page: "https://csclub.uwaterloo.ca",
    description: "Computer science organization",
    school: "University of Waterloo",
    categories: ["Technology"],
    event_count: 0,
    latest_event_title: null,
    latest_event_added_at: null,
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

test.beforeEach(async ({ page }) => {
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("localhost:8000") && status >= 400) {
      console.log(`[API RESPONSE ERROR] ${response.request().method()} ${url} -> ${status}`);
    }
  });

  // Prevent CORS errors on active-ids by mocking it globally for all browser routes
  await page.route(url => apiPath(url) === "/promotions/active-ids", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
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

  await page.route(url => apiPath(url) === "/saved-events", async (route) => {
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

  await page.route(url => apiPath(url)?.startsWith("/events/promoted") === true, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(url => apiPath(url) === "/events", async (route) => {
    if (apiPath(new URL(route.request().url()))?.startsWith("/events/promoted") === true) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: 1,
            title: "Tech Career Fair",
            location: "SLC",
            occurrences: [{ id: 1, event_id: 1, dtstart_utc: startsAt, dtend_utc: null }],
            price: 0,
            food: [],
            registration: false,
            source_image_url: null,
            category: "Career",
            organization: "UW Tech Club",
            school: "University of Waterloo",
            added_at: now.toISOString(),
            click_count: 0,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
        latest_added_event: {
          title: "Tech Career Fair",
          added_at: now.toISOString(),
        },
      }),
    });
  });

  await page.route(url => apiPath(url) === "/organizations", async (route) => {
    const requestUrl = new URL(route.request().url());
    const search = requestUrl.searchParams.get("search")?.toLowerCase() ?? "";
    const ids = requestUrl.searchParams.getAll("ids").map(Number);
    let items = MOCK_ORGANIZATIONS;

    if (search) {
      items = items.filter((organization) =>
        organization.organization_name.toLowerCase().includes(search)
      );
    }
    if (ids.length > 0) {
      items = items.filter((organization) => ids.includes(organization.id));
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
  });
});

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
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
        school: "University of Waterloo",
        faculty: "Mathematics",
        interests: [],
        is_first_year: false,
        role: "admin",
      }),
    });
  });

  // Mock organizations/mine
  await page.route(url => apiPath(url) === "/organizations/mine", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_ORGANIZATIONS[0]]),
    });
  });

  // Mock integrations endpoints
  const platforms = ["whatsapp", "discord", "slack", "telegram", "linkedin", "facebook", "instagram"];
  for (const p of platforms) {
    await page.route(url => apiPath(url)?.match(new RegExp(`^/organizations/\\d+/integrations/${p}$`)) != null, async (route) => {
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

    await page.route(url => apiPath(url) === `/organizations/integrations/${p}/options`, async (route) => {
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

  // Mock saved organizations
  await page.route(url => apiPath(url) === "/saved-organizations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock credits
  await page.route(url => apiPath(url) === "/credits", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 100 }),
    });
  });

  // Mock saved events
  await page.route(url => apiPath(url) === "/saved-events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock active promotions IDs
  await page.route(url => apiPath(url) === "/promotions/active-ids", async (route) => {
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
    hasOrganization: true,
    clubs: [
      {
        id: 1,
        organization_name: "UW Tech Club",
      }
    ],
    organizationId: 1,
    organizationName: "UW Tech Club",
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
  await page.route(new RegExp(`${APP_API}/qr/\\?`), async (route) => {
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

  await page.route(new RegExp(`${APP_API}/qr/scans`), async (route) => {
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
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible();
    await expect(page.getByText(/platform terms/i)).toBeVisible();
  });

  test("continues from email to verification code entry", async ({ page }) => {
    await page.route(url => apiPath(url) === "/auth/send-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "sent" }),
      });
    });

    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/6-digit login code/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /verify code/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /resend code/i })).toBeVisible();
  });

  test("submit button is disabled until form is valid", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const submit = page.getByRole("button", { name: /continue/i });

    await expect(submit).toBeDisabled();

    await page.locator('input[type="email"]').fill("not-valid-email");
    await expect(submit).toBeDisabled();

    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await expect(submit).toBeEnabled();
  });

  test("shows error on invalid signup attempt", async ({ page }) => {
    await page.route(url => apiPath(url) === "/auth/send-otp", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Use a supported school email" }),
      });
    });

    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill("bad@example.com");
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText("Use a supported school email")).toBeVisible({ timeout: 10000 });
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

// ── Workflow 8: Organization Integrations ─────────────────────────────

test.describe("Organization Integrations", () => {
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

  test("share and report overflow actions do not open event details", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const card = page.locator('article[data-event-id="1"]').first();
    await expect(card).toBeVisible();

    const overflowButton = card.getByRole("button", { name: "Actions" });
    await overflowButton.click();
    await page.getByRole("menuitem", { name: "Share" }).click();

    await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();
    await expect(page).not.toHaveURL(/eventId=1/);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Share" })).not.toBeVisible();

    await overflowButton.click();
    await page.getByRole("menuitem", { name: "Report" }).click();

    await expect(page.getByRole("heading", { name: /Report event/i })).toBeVisible();
    await expect(page).not.toHaveURL(/eventId=1/);
  });

  test("closes event details opened from a direct eventId link", async ({ page }) => {
    await page.goto(`${BASE}/?eventId=1`);
    await page.waitForTimeout(3000);

    await expect(page).toHaveURL(/eventId=1/);
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();

    await expect(page).not.toHaveURL(/eventId=1/);
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("keeps click count optimistic when opening event details", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const card = page.locator('article[data-event-id="1"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("0 clicks");

    await card.click({ position: { x: 30, y: 30 } });

    await expect(page).toHaveURL(/eventId=1/);
    await expect(card).toContainText("1 click");

    await page.waitForTimeout(500);
    await expect(card).toContainText("1 click");
  });

  test("app API proxy returns events", async ({ request }) => {
    const res = await request.get(`${APP_API}/events/`);
    expect(res.status()).toBe(200);
    const feed = await res.json();
    const events = feed.items;
    expect(feed).toHaveProperty("latest_added_event");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty("title");
    expect(events[0]).toHaveProperty("location");
    expect(events[0]).toHaveProperty("id");
  });

  test("app API proxy preserves the event feed contract", async ({ request }) => {
    const res = await request.get(`${APP_API}/events/`);
    const feed = await res.json();
    expect(feed.total).toBeGreaterThanOrEqual(feed.items.length);
    expect(feed.page).toBeGreaterThanOrEqual(1);
    expect(feed.page_size).toBeGreaterThan(0);
    expect(feed.total_pages).toBeGreaterThanOrEqual(1);
  });

  test("event search filter works through app API proxy", async ({ request }) => {
    const res = await request.get(`${APP_API}/events/?search=career`);
    expect(res.status()).toBe(200);
    const feed = await res.json();
    const events = feed.items;
    expect(events.length).toBeGreaterThanOrEqual(1);
    const searchableText = events
      .map((event: { title: string; category?: string; organization?: string | null }) =>
        `${event.title} ${event.category ?? ""} ${event.organization ?? ""}`.toLowerCase(),
      )
      .join(" ");
    expect(searchableText).toContain("career");
  });

  test("event category filter works through app API proxy", async ({ request }) => {
    const res = await request.get(`${APP_API}/events/?categories=Career`);
    expect(res.status()).toBe(200);
    const feed = await res.json();
    const events = feed.items;
    expect(events.every((e: { category: string }) => e.category === "Career")).toBeTruthy();
  });
});

// ── Workflow 3: Organizations Page ────────────────────────────────────

test.describe("Organizations Page", () => {
  test("loads and displays organizations", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/organizations-page.png", fullPage: true });
  });

  test("app API proxy returns organizations", async ({ request }) => {
    const res = await request.get(`${APP_API}/organizations/`);
    expect(res.status()).toBe(200);
    const organizations = await res.json();
    expect(organizations.items.length).toBeGreaterThan(0);
    expect(organizations.items[0]).toHaveProperty("organization_name");
    expect(organizations.items[0]).toHaveProperty("organization_type");
  });

  test("app API proxy preserves the organization paginated contract", async ({ request }) => {
    const res = await request.get(`${APP_API}/organizations/`);
    const organizations = await res.json();
    expect(organizations.total).toBeGreaterThanOrEqual(organizations.items.length);
    expect(
      organizations.items.every(
        (organization: { organization_name?: string; organization_type?: string }) =>
          typeof organization.organization_name === "string" &&
          typeof organization.organization_type === "string",
      ),
    ).toBeTruthy();
  });

  test("organization search filter works through app API proxy", async ({ request }) => {
    const res = await request.get(`${APP_API}/organizations/?search=computer`);
    expect(res.status()).toBe(200);
    const organizations = await res.json();
    expect(organizations.items.length).toBeGreaterThanOrEqual(1);
    const searchableText = organizations.items
      .map((organization: { organization_name: string; categories?: string[] }) =>
        `${organization.organization_name} ${(organization.categories ?? []).join(" ")}`.toLowerCase(),
      )
      .join(" ");
    expect(searchableText).toContain("computer");
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
    const res = await request.post(`${APP_API}/events/`, {
      data: { title: "Test", location: "Test" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("POST /organizations/ requires authentication", async ({ request }) => {
    const res = await request.post(`${APP_API}/organizations/`, {
      data: { organization_name: "Test", organization_type: "Test", categories: ["Technology"] },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("GET /users/me requires authentication", async ({ request }) => {
    const res = await request.get(`${APP_API}/users/me`);
    expect([401, 403]).toContain(res.status());
  });

  test("PATCH /users/me/profile requires authentication", async ({ request }) => {
    const res = await request.patch(`${APP_API}/users/me/profile`, {
      data: { faculty: "Engineering" },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ── Workflow 6: Navigation ────────────────────────────────────────────

test.describe("Navigation", () => {
  test("main pages load without errors", async ({ page }) => {
    const routes = ["/", "/school/uwaterloo", "/login", "/onboarding", "/organizations", "/contact", "/settings"];
    for (const route of routes) {
      const res = await page.goto(`${BASE}${route}`);
      expect(res?.status()).toBe(200);
    }
  });

  test("root rewrite serves the same runtime as direct school route", async ({ request }) => {
    const rootResponse = await request.get(`${BASE}/`);
    const schoolResponse = await request.get(`${BASE}/school/uwaterloo`);
    const rootHtml = await rootResponse.text();
    const schoolHtml = await schoolResponse.text();

    expect(rootResponse.status()).toBe(200);
    expect(schoolResponse.status()).toBe(200);
    expect(rootHtml).not.toContain("server-event-feed");
    expect(schoolHtml).not.toContain("server-event-feed");
    expect(rootHtml.includes("hmr-client")).toBe(schoolHtml.includes("hmr-client"));
    expect(rootHtml.includes("next-devtools")).toBe(schoolHtml.includes("next-devtools"));
  });

  test("events page first paint uses app chrome, not an empty shell", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#server-event-feed")).toHaveCount(0);
    const loadingStatus = page.getByRole("status").first();
    if (await loadingStatus.count()) {
      await expect(loadingStatus).toBeVisible();
      await expect(loadingStatus).toHaveAccessibleName(/Loading/i);
      return;
    }

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
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
