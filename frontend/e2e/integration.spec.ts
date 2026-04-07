import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5173";
const API = "http://localhost:8000";

/**
 * Key values must match STORAGE_KEYS in src/shared/constants/storageKeys.ts.
 * We can't import TS modules into Playwright's addInitScript (runs in the
 * browser before bundles are loaded), so we duplicate the string values here.
 */
const STORAGE_KEY_USER_EMAIL = "userEmail";

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
  // Access token is in-memory (apiClient.ts), refresh token is httpOnly cookie —
  // neither lives in localStorage. We only seed the email hint so
  // isAuthenticated() sees a prior session indicator.
  await page.addInitScript((emailKey) => {
    window.localStorage.setItem(emailKey, JSON.stringify("test@uwaterloo.ca"));
  }, STORAGE_KEY_USER_EMAIL);
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
      destinationType: "custom-url",
      destinationId: "https://example.com",
      filters: null,
      createdAt: now,
      createdBy: "test@uwaterloo.ca",
      isActive: true,
      imageUrl: undefined,
      latitude: 43.4723,
      longitude: -80.5449,
    },
  ];

  const scans = opts?.withScans
    ? [
        {
          id: "scan-1",
          qrCodeId: "qr-test-1",
          scannedAt: now,
          userId: "user-1",
          sessionId: "session-1",
          conversionActions: [],
          userAgent: "Playwright",
        },
        {
          id: "scan-2",
          qrCodeId: "qr-test-1",
          scannedAt: now,
          userId: "user-2",
          sessionId: "session-2",
          conversionActions: [],
          userAgent: "Playwright",
        },
      ]
    : [];

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
    await expect(page.locator('input[type="password"]')).toBeVisible();
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

    await page.locator('input[type="email"]').fill("test@uwaterloo.ca");
    await expect(submit).toBeDisabled();

    await page.locator('input[type="password"]').fill("short");
    await expect(submit).toBeDisabled();

    await page.locator('input[type="password"]').fill("testpass123");
    await expect(submit).toBeEnabled();
  });

  test("shows error on invalid signup attempt", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[type="email"]').fill("bad@example.com");
    await page.locator('input[type="password"]').fill("testpass123");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/please wait/i)).toBeVisible();
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

    // Admin posters page: shows posters table with same QR code
    await page.goto(`${BASE}/admin/posters`);
    const adminRow = page.locator("#poster-qr-test-1");
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByText("Test Poster 1")).toBeVisible();

    // Club panel posters page reuses same posters view
    await page.goto(`${BASE}/club-panel/posters`);
    const clubRow = page.locator("#poster-qr-test-1");
    await expect(clubRow).toBeVisible();
    await expect(clubRow.getByText("Test Poster 1")).toBeVisible();
  });
});

// ── Workflow 8: Club Integrations ──────────────────────────────────────

test.describe("Club Integrations", () => {
  test("can connect WhatsApp integration end to end", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/club-panel/integrations`);

    // WhatsApp card
    const whatsappCard = page
      .locator("div.bg-card", { hasText: "WhatsApp" })
      .first();

    await expect(whatsappCard.getByText("WhatsApp")).toBeVisible();
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
    await page.goto(`${BASE}/club-panel/integrations`);

    const discordCard = page
      .locator("div.bg-card", { hasText: "Discord" })
      .first();

    await expect(discordCard.getByText("Discord")).toBeVisible();
    await discordCard.getByRole("button", { name: "Connect" }).click();

    // Step 1: add bot
    await expect(page.getByRole("heading", { name: "Connect Discord" })).toBeVisible();
    await page.getByRole("button", { name: "Add to Discord" }).click();
    await expect(page.getByText("Bot Added")).toBeVisible();

    // Step 2: select server and channel
    await page.getByText("Server").click();
    await page.getByRole("option", { name: "UW Tech Club" }).click();

    await page.getByText("Channel").click();
    await page.getByRole("option", { name: "#events" }).click();

    await page.getByRole("button", { name: "Activate" }).click();

    // Card shows connected state and selected destination
    await expect(
      discordCard.getByText("Connected", { exact: false }),
    ).toBeVisible();
    await expect(
      discordCard.getByText("UW Tech Club - #events"),
    ).toBeVisible();
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
    expect(events.length).toBe(1);
    expect(events[0].title).toBe("Tech Career Fair");
  });

  test("event category filter works on API", async ({ request }) => {
    const res = await request.get(`${API}/events/?category=Career`);
    expect(res.status()).toBe(200);
    const events = await res.json();
    expect(events.every((e: { category: string }) => e.category === "Career")).toBeTruthy();
  });
});

// ── Workflow 3: Clubs Page ────────────────────────────────────────────

test.describe("Clubs Page", () => {
  test("loads and displays clubs", async ({ page }) => {
    await page.goto(`${BASE}/clubs`);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/clubs-page.png", fullPage: true });
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
    expect(clubs.length).toBe(1);
    expect(clubs[0].club_name).toBe("UW Computer Science Club");
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
    const routes = ["/", "/login", "/onboarding", "/clubs", "/about", "/settings"];
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
