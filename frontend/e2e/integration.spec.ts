import { test, expect, type Page } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "../src/shared/constants/uploads";
import arTranslations from "../src/shared/locales/ar.json";

const BASE = "http://127.0.0.1:3000";
const APP_API = `${BASE}/api`;

/** Shared test identity used across auth-seeded tests. */
const TEST_EMAIL = "test@uwaterloo.ca";

const MOCK_ORGANIZATIONS = [
  {
    id: 1,
    organization_name: "UW Tech Club",
    organization_type: "independent",
    organization_page: "https://example.com/tech",
    description: "A test organization",
    school: "uwaterloo",
    categories: ["Technology"],
    event_count: 1,
  },
  {
    id: 2,
    organization_name: "UW Board Games Club",
    organization_type: "independent",
    organization_page: "https://example.com/board-games",
    description: "Board games organization",
    school: "uwaterloo",
    categories: ["Social"],
    event_count: 1,
  },
  {
    id: 3,
    organization_name: "UW Computer Science Club",
    organization_type: "independent",
    organization_page: "https://csclub.uwaterloo.ca",
    description: "Computer science organization",
    school: "uwaterloo",
    categories: ["Technology"],
    event_count: 0,
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function resolveThemeColors(
  page: Page,
  variables: readonly string[],
): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const sample = document.createElement("div");
    document.body.append(sample);
    const colors = Object.fromEntries(
      names.map((name) => {
        sample.style.backgroundColor = `var(${name})`;
        return [name, getComputedStyle(sample).backgroundColor];
      }),
    );
    sample.remove();
    return colors;
  }, variables);
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

  await page.route(url => apiPath(url) === "/schools", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          slug: "uwaterloo",
          name: "University of Waterloo",
          primary_color: "#6b238e",
          secondary_color: "#ffd54f",
          email_domains: ["uwaterloo.ca"],
        },
      ]),
    });
  });

  await page.route(url => apiPath(url) === "/going-events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(url => apiPath(url) === "/events/stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
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
            organization_id: 1,
            organization: "UW Tech Club",
            organization_type: "wusa",
            organization_page: "https://example.com/tech",
            organization_ig: "uwtechclub",
            organization_discord: "https://discord.gg/uwtechclub",
            school: "uwaterloo",
            added_at: now.toISOString(),
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

test.describe("Language loading", () => {
  test("loads and persists an RTL locale after first paint", async ({ page }) => {
    await page.goto(BASE);

    const documentElement = page.locator("html");
    await expect(documentElement).toHaveAttribute("lang", "en");
    await expect(documentElement).toHaveAttribute("dir", "ltr");

    await page.getByRole("combobox").filter({ hasText: "English" }).click();
    await page.getByRole("option", { name: "العربية" }).click();

    await expect(documentElement).toHaveAttribute("lang", "ar");
    await expect(documentElement).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("button", {
        name: arTranslations.navigation.goToEvents,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.localStorage.getItem(key),
          STORAGE_KEYS.LANGUAGE,
        ),
      )
      .toBe(JSON.stringify("ar"));

    await page.reload();

    await expect(documentElement).toHaveAttribute("lang", "ar");
    await expect(documentElement).toHaveAttribute("dir", "rtl");
  });
});

test.describe("SEO discovery routes", () => {
  test("publishes crawl rules and the school sitemap location", async ({
    request,
  }) => {
    const response = await request.get(`${BASE}/robots.txt`);

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /admin/");
    expect(body).toContain(
      "Sitemap: https://uwaterloo.wat2do.io/sitemap.xml",
    );
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
        school: "uwaterloo",
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
  await page.route(url => apiPath(url) === "/going-events", async (route) => {
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
    school: "uwaterloo",
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

// ── Global navigation progress ────────────────────────────────────────

test.describe("Navigation progress", () => {
  test("starts immediately and waits for destination loading UI to clear", async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/contact";
      link.dataset.testid = "controlled-navigation-link";
      link.textContent = "Navigate";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.append(link);
    });

    const progress = page.locator('[data-slot="navigation-progress"]');
    const immediateState = await page
      .getByTestId("controlled-navigation-link")
      .evaluate((link) => {
        (link as HTMLAnchorElement).click();
        return document
          .querySelector('[data-slot="navigation-progress"]')
          ?.getAttribute("data-state");
      });

    expect(immediateState).toBe("priming");
    await expect(progress).toHaveAttribute(
      "data-state",
      /priming|starting|loading/,
    );
    await expect(progress).toHaveCSS("height", "2px");
    await expect(progress).toHaveCSS("top", "0px");
    await expect(progress).toHaveCSS("opacity", "1");
    await expect(progress).toHaveCSS("transition-duration", "0s");

    await page.evaluate(() => {
      const unrelatedSkeleton = document.createElement("div");
      unrelatedSkeleton.dataset.slot = "skeleton";
      unrelatedSkeleton.dataset.testid = "persistent-skeleton";
      document.body.append(unrelatedSkeleton);

      const loadingState = document.createElement("div");
      loadingState.setAttribute("aria-busy", "true");
      loadingState.dataset.testid = "controlled-loading-state";
      document.body.append(loadingState);
      window.history.pushState({}, "", "/?navigation-progress=complete");
    });

    await page.waitForTimeout(400);
    await expect(progress).toHaveAttribute(
      "data-state",
      /priming|starting|loading/,
    );

    await page.getByTestId("controlled-loading-state").evaluate((element) => {
      element.remove();
    });
    await expect(progress).toHaveAttribute("data-state", "idle");
    await expect(page.getByTestId("persistent-skeleton")).toHaveCount(1);
  });
});

// ── Workflow 1: Auth Page ─────────────────────────────────────────────

test.describe("Auth Page", () => {
  test("keeps the cached session when a deploy interrupts a 401 retry", async ({
    page,
  }) => {
    let refreshRequestCount = 0;
    await page.route(url => apiPath(url) === "/auth/refresh", async (route) => {
      refreshRequestCount += 1;
      if (refreshRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "expired-access-token",
            token_type: "bearer",
            expires_in: 1,
            user_id: "mock-user-id",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Service restarting" }),
      });
    });
    await page.route(url => apiPath(url) === "/users/me", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Access token expired" }),
      });
    });
    await page.addInitScript(
      ({ emailKey, email }) => {
        window.localStorage.setItem(emailKey, JSON.stringify(email));
      },
      { emailKey: STORAGE_KEYS.USER_EMAIL, email: TEST_EMAIL },
    );

    await page.goto(BASE);

    await expect.poll(() => refreshRequestCount).toBe(2);
    await expect
      .poll(() =>
        page.evaluate((emailKey) => window.localStorage.getItem(emailKey), STORAGE_KEYS.USER_EMAIL),
      )
      .toBe(JSON.stringify(TEST_EMAIL));
  });

  test("keeps the server-rendered headline mounted through app readiness", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let heading: Element | null = null;
      let removed = false;
      const readHeading = () => {
        heading ??= document.querySelector("h1");
        if (heading && !heading.isConnected) {
          removed = true;
        }
      };
      const observer = new MutationObserver(readHeading);
      observer.observe(document, { childList: true, subtree: true });
      Object.defineProperty(window, "__readHydrationHeadingProbe", {
        configurable: true,
        value: () => ({ captured: heading !== null, removed }),
      });
    });

    await page.goto(`${BASE}/login`);
    await expect(page.locator("h1")).toContainText("Discover");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.dataset.clientReady),
      )
      .toBe("true");

    const probe = await page.evaluate(() =>
      (
        window as typeof window & {
          __readHydrationHeadingProbe: () => {
            captured: boolean;
            removed: boolean;
          };
        }
      ).__readHydrationHeadingProbe(),
    );
    expect(probe).toEqual({ captured: true, removed: false });
  });

  test("renders signup form by default", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator("h1")).toContainText("Discover");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/platform terms/i)).toBeVisible();
    await expect(
      page.getByTestId("auth-preview-events").locator(":scope > *"),
    ).toHaveCount(4);
  });

  test("starts Google OAuth with the same-origin backend callback", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.endsWith("/auth/google"),
      async (route) => route.abort(),
    );
    await page.goto(`${BASE}/login?returnTo=%2Fpositions`);
    const googleRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith("/auth/google"),
    );

    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    const requestUrl = new URL((await googleRequest).url());

    expect(requestUrl.searchParams.get("callback_url")).toBe(
      `${BASE}/api/auth/google/callback`,
    );
    expect(requestUrl.searchParams.get("return_to")).toBe("/positions");
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
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .click();

    await expect(page.getByText(/6-digit login code/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /verify code/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /resend code/i })).toBeVisible();
  });

  test("submit button is disabled until form is valid", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const submit = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });

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
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .click();

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

test.describe("Admin diagnostics", () => {
  test("opens from the admin dashboard and shows Automate logs under scraping", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await seedQrData(page);
    await page.route(url => apiPath(url) === "/submissions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          total: 0,
          page: 1,
          page_size: 20,
          total_pages: 0,
        }),
      });
    });

    await page.goto(`${BASE}/admin`);
    await page.getByRole("button", { name: /App Diagnostics/ }).click();

    await expect(page).toHaveURL(`${BASE}/admin/diagnostics`);
    await expect(
      page.getByRole("heading", { name: "App Diagnostics" }),
    ).toBeVisible();

    const endpointsTab = page.getByRole("tab", { name: "Endpoints" });
    const scrapingTab = page.getByRole("tab", { name: "Scraping" });
    const automateLogs = page.getByRole("heading", { name: "Automate Logs" });

    await expect(endpointsTab).toBeVisible();
    await expect(scrapingTab).toHaveAttribute("data-state", "active");
    await expect(automateLogs).toBeVisible();
    await expect(
      page.getByText("Automate log output will appear here."),
    ).toBeVisible();

    await endpointsTab.click();
    await expect(automateLogs).toBeHidden();

    await scrapingTab.click();
    await expect(automateLogs).toBeVisible();
  });
});

test.describe("Admin Instagram publishing", () => {
  test("adds an existing event by ID without opening event creation", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);

    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const eventSummary = (id: number, title: string) => ({
      id,
      title,
      description: `${title} description`,
      location: "SLC",
      occurrences: [
        {
          id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
          event_id: id,
          dtstart_utc: startsAt,
          dtend_utc: null,
        },
      ],
      price: 0,
      food: [],
      registration: false,
      source_image_url: null,
      source_url: null,
      category: "Technology",
      organization: "UW Tech Club",
      organization_type: "independent",
      organization_page: "https://example.com/tech",
      organization_ig: "uwtechclub",
      organization_discord: null,
      ig_handle: "uwtechclub",
      school: "uwaterloo",
      cancelled: false,
      added_at: new Date().toISOString(),
    });
    const firstEvent = eventSummary(1, "First Carousel Event");
    const secondEvent = eventSummary(2, "Second Carousel Event");
    const batchItem = (event: ReturnType<typeof eventSummary>, position: number) => ({
      id: `00000000-0000-4000-9000-${String(event.id).padStart(12, "0")}`,
      batch_id: "00000000-0000-4000-8000-000000000001",
      account_key: "uwaterloo",
      event_id: event.id,
      position,
      event,
      published_asset_url: null,
      published_at: null,
      created_at: "2026-08-03T12:00:00Z",
      updated_at: "2026-08-03T12:00:00Z",
    });
    const batchBase = {
      id: "00000000-0000-4000-8000-000000000001",
      account_key: "uwaterloo",
      instagram_user_id: "17841476154506771",
      school: "uwaterloo",
      local_date: "2026-08-03",
      window_start: "2026-08-02T12:00:00Z",
      window_end: "2026-08-03T12:00:00Z",
      status: "ready_for_review",
      caption: "Campus events",
      cover_body: "Our latest picks",
      ai_model: null,
      error_message: null,
      meta_media_id: null,
      published_cover_url: null,
      created_at: "2026-08-03T12:00:00Z",
      updated_at: "2026-08-03T12:00:00Z",
      published_at: null,
    } as const;
    const initialBatch = {
      ...batchBase,
      version: 1,
      new_event_count: 2,
      items: [batchItem(firstEvent, 1)],
    };
    const savedBatch = {
      ...initialBatch,
      version: 2,
      items: [batchItem(firstEvent, 1), batchItem(secondEvent, 2)],
    };
    let savedEventIds: number[] | null = null;

    await page.route(url => apiPath(url) === "/instagram-publishing/batches", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ ...batchBase, version: 1, item_count: 1 }],
          total: 1,
          page: 1,
          page_size: 25,
          total_pages: 1,
        }),
      });
    });
    await page.route(
      url => apiPath(url) === `/instagram-publishing/batches/${batchBase.id}`,
      async (route) => {
        if (route.request().method() === "PATCH") {
          const requestBody = route.request().postDataJSON() as { event_ids: number[] };
          savedEventIds = requestBody.event_ids;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(savedBatch),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(initialBatch),
        });
      },
    );
    await page.route(url => apiPath(url) === "/events/2", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...secondEvent, organization_id: 1 }),
      });
    });

    await page.goto(`${BASE}/admin/instagram`);
    await page.getByRole("button", { name: "uwaterloo" }).click();

    const drawer = page.getByRole("dialog", { name: "uwaterloo" });
    await drawer.getByRole("button", { name: "Add event ID" }).click();

    const eventIdInput = drawer.getByRole("spinbutton", { name: "Event ID" });
    const addEventForm = eventIdInput.locator("xpath=ancestor::form");
    const submitEventId = addEventForm.getByRole("button", { name: "Add event ID" });
    await expect(eventIdInput).toBeVisible();
    await expect(drawer.getByText("Create Event", { exact: true })).toHaveCount(0);

    await eventIdInput.fill("1");
    await expect(submitEventId).toBeDisabled();
    await eventIdInput.fill("2");
    await expect(submitEventId).toBeEnabled();
    await submitEventId.click();

    await expect.poll(() => savedEventIds).toEqual([1, 2]);
    await expect(drawer.getByText("Slide 2 of 2").first()).toBeVisible();
    await expect(drawer.getByText("Second Carousel Event").first()).toBeVisible();
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
  test("returns one upcoming event for the random search command", async ({
    page,
  }) => {
    await page.goto(BASE);

    const cards = page.locator("article[data-event-id]");
    await expect(cards).toHaveCount(1);

    const search = page.getByPlaceholder("Search events");
    await search.fill("RaNdOm");
    await search.press("Enter");

    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute(
      "aria-label",
      "Event: Tech Career Fair",
    );
  });

  test("keeps vertical scrolling on the application content root", async ({
    page,
  }) => {
    await page.goto(BASE);

    const scrollState = await page.locator(".main-content-grid").evaluate((scrollRoot) => ({
      documentCanScroll:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      scrollRootOverflowY: getComputedStyle(scrollRoot).overflowY,
    }));

    expect(scrollState).toEqual({
      documentCanScroll: false,
      scrollRootOverflowY: "auto",
    });
  });

  test("renders the organization type icon from the event feed signature", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const assetResponse = page.waitForResponse(
      response =>
        response.url().endsWith("/icons/organization-types/utsc-scsu.svg") &&
        response.status() === 200,
    );
    await page.goto("http://utsc.localhost:3000/school/utsc");

    await expect(
      page.getByRole("heading", { name: "UTSC Eats SCSU Logo Preview" }),
    ).toBeVisible();

    const icon = page.getByRole("img", {
      name: "Organization type: SCSU",
    }).first();
    await expect(icon).toBeVisible();
    await expect
      .poll(() => icon.evaluate(element => getComputedStyle(element).maskImage))
      .toContain("/icons/organization-types/utsc-scsu.svg");

    const eventGrid = page.locator('[role="list"] section > div.grid').first();
    await expect
      .poll(() =>
        eventGrid.evaluate(
          element => getComputedStyle(element).gridTemplateColumns.split(" ").length,
        ),
      )
      .toBe(6);

    const organizationName = page
      .getByText("UTSC Eats Campus Group", { exact: true })
      .first();
    await expect
      .poll(() =>
        organizationName.evaluate(element => ({
          maxWidth: getComputedStyle(element).maxWidth,
          overflow: getComputedStyle(element).overflow,
          textOverflow: getComputedStyle(element).textOverflow,
          isTruncated: element.scrollWidth > element.clientWidth,
          staysInsideCard:
            (element.closest("button")?.getBoundingClientRect().right ??
              Infinity) <=
            (element.closest("article")?.getBoundingClientRect().right ??
              -Infinity) + 0.5,
          wordmarkStaysInsideCard:
            (element.parentElement
              ?.querySelector('[role="img"]')
              ?.getBoundingClientRect().right ?? Infinity) <=
            (element.closest("article")?.getBoundingClientRect().right ??
              -Infinity) + 0.5,
        })),
      )
      .toEqual({
        maxWidth: "224px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        isTruncated: true,
        staysInsideCard: true,
        wordmarkStaysInsideCard: true,
      });
    await assetResponse;
  });

  test("loads and displays events", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    const eventCount = page.getByText("upcoming event", { exact: true }).locator("..");
    const addEventButton = page.getByRole("button", { name: "Add event" });
    const moreFiltersButton = page.getByRole("button", {
      name: "More filters",
    });
    const eventSearch = page.getByPlaceholder("Search events").locator("..");
    await expect(
      page.getByRole("heading", { name: /events and things to do/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/Find current campus events/i)).toHaveCount(0);
    await expect(addEventButton.locator("svg")).toHaveCount(0);
    await expect(addEventButton).toHaveCSS("padding-left", "20px");
    await expect(addEventButton).toHaveCSS("padding-right", "20px");
    await expect
      .poll(async () => {
        const [
          searchBox,
          addEventBox,
          moreFiltersBox,
          sharesSearchRow,
          filtersBesideStrip,
        ] = await Promise.all([
          eventSearch.boundingBox(),
          addEventButton.boundingBox(),
          moreFiltersButton.boundingBox(),
          eventSearch.evaluate((searchElement) =>
            Boolean(
              searchElement.parentElement
                ?.querySelector("button")
                ?.textContent?.includes("Add event"),
            ),
          ),
          page
            .getByTestId("event-quick-filter-scroll")
            .evaluate((strip) =>
              Boolean(
                strip.parentElement?.parentElement
                  ?.querySelector("button")
                  ?.textContent?.includes("More filters"),
              ),
            ),
        ]);
        return {
          searchHeight: searchBox?.height,
          addEventHeight: addEventBox?.height,
          moreFiltersHeight: moreFiltersBox?.height,
          sharesSearchRow,
          filtersBesideStrip,
        };
      })
      .toEqual({
        searchHeight: 44,
        addEventHeight: 44,
        moreFiltersHeight: 32,
        sharesSearchRow: true,
        filtersBesideStrip: true,
      });
    await expect
      .poll(async () =>
        eventCount.evaluate(
          (countElement) =>
            countElement.parentElement?.querySelector("button") === null,
        ),
      )
      .toBe(true);

    await page.screenshot({ path: "e2e/screenshots/events-page.png", fullPage: true });
  });

  test("permanently filters events after their effective end", async ({ page }) => {
    const nowMs = Date.now();
    const eventBase = {
      location: "SLC",
      price: 0,
      food: [],
      registration: false,
      source_image_url: null,
      category: "Career",
      organization: "UW Tech Club",
      organization_type: "wusa",
      school: "uwaterloo",
      added_at: new Date(nowMs).toISOString(),
    };
    const event = (
      id: number,
      title: string,
      startOffsetMinutes: number,
      endOffsetMinutes: number | null,
    ) => ({
      ...eventBase,
      id,
      title,
      occurrences: [
        {
          id,
          event_id: id,
          dtstart_utc: new Date(
            nowMs + startOffsetMinutes * 60_000,
          ).toISOString(),
          dtend_utc:
            endOffsetMinutes === null
              ? null
              : new Date(nowMs + endOffsetMinutes * 60_000).toISOString(),
        },
      ],
    });
    const items = [
      event(1, "Future Event", 60, null),
      event(2, "Within Sixty Minutes", -59, null),
      event(3, "Past Sixty Minutes", -61, null),
      event(4, "Already Ended", -120, -1),
      event(5, "Still Running", -120, 60),
    ];

    await page.route(url => apiPath(url) === "/events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          total: items.length,
          page: 1,
          page_size: 100,
          total_pages: 1,
          latest_added_event: null,
        }),
      });
    });

    await page.goto(BASE);

    await expect(page.locator('article[data-event-id="1"]')).toBeVisible();
    await expect(page.locator('article[data-event-id="2"]')).toBeVisible();
    await expect(page.locator('article[data-event-id="5"]')).toBeVisible();
    await expect(page.locator('article[data-event-id="3"]')).toHaveCount(0);
    await expect(page.locator('article[data-event-id="4"]')).toHaveCount(0);
  });

  test("shares and reports from event details while logged out", async ({ page }) => {
    let submittedReport: Record<string, unknown> | null = null;
    await page.route(url => apiPath(url) === "/reports", async (route) => {
      submittedReport = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "report-1",
          event_id: 1,
          user_id: null,
          reason: "Incorrect event details",
          status: "pending",
          reported_at: new Date().toISOString(),
          resolved_at: null,
        }),
      });
    });

    await page.goto(BASE);

    const card = page.locator('article[data-event-id="1"]').first();
    await expect(card).toBeVisible();
    const openedSynchronously = await card.evaluate((element) => {
      (element as HTMLElement).click();
      return (
        document
          .querySelector('[data-slot="drawer-content"]')
          ?.getAttribute("data-state") === "open"
      );
    });
    expect(openedSynchronously).toBe(true);
    await expect(page).toHaveURL(`${BASE}/`);

    const eventDrawer = page.getByRole("dialog", { name: "Tech Career Fair" });
    const hostSection = eventDrawer.locator('[data-slot="event-host"]');
    const hostLinks = hostSection.locator(':scope > [data-slot="event-host-links"]');
    await expect(hostSection.getByText("UW Tech Club")).toBeVisible();
    await expect(hostLinks.getByRole("link", { name: "Visit Website" })).toBeVisible();
    await expect(hostLinks.getByRole("link", { name: "Instagram" })).toBeVisible();
    await expect(hostLinks.getByRole("link", { name: "Discord" })).toBeVisible();
    await expect(
      eventDrawer.getByRole("heading", { name: "Contact the Host" }),
    ).toHaveCount(0);
    await eventDrawer.getByRole("button", { name: "Share" }).click();

    await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share on LINE" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share on WeChat" })).toBeVisible();
    await expect(eventDrawer.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(window, "open", {
        configurable: true,
        value: (url: string | URL) => {
          sessionStorage.setItem("e2e-line-share-url", String(url));
          return null;
        },
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          sessionStorage.setItem("e2e-native-share-data", JSON.stringify(data));
        },
      });
    });

    await page.getByRole("button", { name: "Share on LINE" }).click();
    const lineShareUrl = await page.evaluate(() =>
      sessionStorage.getItem("e2e-line-share-url"),
    );
    expect(lineShareUrl).not.toBeNull();
    const parsedLineShareUrl = new URL(lineShareUrl!);
    expect(parsedLineShareUrl.origin).toBe("https://social-plugins.line.me");
    expect(parsedLineShareUrl.pathname).toBe("/lineit/share");
    expect(parsedLineShareUrl.searchParams.get("url")).toBe(`${BASE}/events/1`);
    const lineShareText = parsedLineShareUrl.searchParams.get("text");
    expect(lineShareText).toContain("Tech Career Fair");
    expect(lineShareText).toContain("SLC");

    await page.getByRole("button", { name: "Share on WeChat" }).click();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("e2e-native-share-data")))
      .not.toBeNull();
    const nativeShareData = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("e2e-native-share-data") ?? "null"),
    );
    expect(nativeShareData).toMatchObject({
      title: "Tech Career Fair",
      text: expect.stringContaining("SLC"),
      url: `${BASE}/events/1`,
    });

    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
    });
    await page.getByRole("button", { name: "Share on WeChat" }).click();
    await expect(page.getByRole("heading", { name: "Scan with WeChat" })).toBeVisible();
    await expect(page.locator('[data-slot="wechat-share-qr"] svg')).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Share on WeChat" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Share" })).not.toBeVisible();

    await eventDrawer.getByRole("button", { name: "Report" }).click();

    const reportDialog = page.getByRole("dialog", { name: "Report event" });
    await reportDialog
      .getByLabel("Share the reason for this report")
      .fill("Incorrect event details");
    await reportDialog.getByRole("button", { name: "Submit report" }).click();

    await expect(
      reportDialog.getByRole("heading", { name: "Report submitted" }),
    ).toBeVisible();
    expect(submittedReport).toEqual({
      event_id: 1,
      reason: "Incorrect event details",
    });
  });

  test("opens the event poster in-app and closes the drawer after filtering by host", async ({
    page,
  }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    const posterUrl = "https://wat2do.io/media/e2e-event-poster.png";
    const optimizedPosterUrl = `/_next/image?url=${encodeURIComponent(posterUrl)}&w=384&q=75`;
    const optimizedPosterWidths: string[] = [];
    const posterBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const event = {
      id: 1,
      organization_id: 1,
      title: "Poster Dialog Event",
      description: "Poster dialog details",
      location: "SLC",
      occurrences: [
        {
          id: 1,
          event_id: 1,
          dtstart_utc: startsAt,
          dtend_utc: null,
        },
      ],
      price: 0,
      food: [],
      registration: false,
      source_image_url: posterUrl,
      source_url: null,
      category: "Career",
      organization: "UW Tech Club",
      organization_type: "wusa",
      organization_page: "https://example.com/tech",
      organization_ig: "uwtechclub",
      organization_discord: "https://discord.gg/uwtechclub",
      school: "uwaterloo",
      cancelled: false,
      added_at: now.toISOString(),
    };

    await page.route(
      url =>
        url.pathname === "/_next/image" &&
        url.searchParams.get("url") === posterUrl,
      async (route) => {
        optimizedPosterWidths.push(new URL(route.request().url()).searchParams.get("w") ?? "");
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: posterBytes,
        });
      },
    );
    await page.route(posterUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: posterBytes,
      });
    });

    await page.route(url => apiPath(url) === "/events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [event],
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
          latest_added_event: null,
        }),
      });
    });
    await page.route(url => apiPath(url) === "/events/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(event),
      });
    });

    await page.goto(BASE);
    const eventCard = page.locator('article[data-event-id="1"]');
    await expect(eventCard.locator("foreignObject")).toHaveCount(0);
    await expect(eventCard.locator("svg > g > image")).toHaveAttribute(
      "href",
      optimizedPosterUrl,
    );
    await eventCard.click();

    const eventDrawer = page.getByRole("dialog", { name: "Poster Dialog Event" });
    await expect(eventDrawer.locator("svg > g > image").first()).toHaveAttribute(
      "href",
      optimizedPosterUrl,
    );
    await expect.poll(() => optimizedPosterWidths.length).toBeGreaterThan(0);
    expect(optimizedPosterWidths).toEqual(
      expect.arrayContaining(["384"]),
    );
    expect(optimizedPosterWidths).not.toContain("1200");
    await eventDrawer.getByRole("button", { name: "View full event image" }).click();

    const imageDialog = page.getByRole("dialog", { name: "View full event image" });
    await expect(imageDialog.getByRole("img", { name: "Poster Dialog Event" })).toBeVisible();
    await imageDialog.getByRole("button", { name: "Close" }).click();

    await eventDrawer.getByRole("button", { name: "UW Tech Club" }).click();
    await page
      .getByRole("menuitem", { name: "See more events by UW Tech Club" })
      .click();

    await expect(eventDrawer).not.toBeVisible();
    await expect(page).toHaveURL(BASE + "/");
    await expect(page.locator('article[data-event-id="1"]')).toBeVisible();
  });

  test("lets admins delete events from the drawer and dedicated page", async ({ page }) => {
    await seedAuthenticatedSession(page);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    let deleteRequests = 0;

    await page.route(url => apiPath(url) === "/events/1", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteRequests += 1;
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          organization_id: 1,
          title: "Tech Career Fair",
          description: "Meet campus employers.",
          location: "SLC",
          occurrences: [
            {
              id: 1,
              event_id: 1,
              dtstart_utc: startsAt,
              dtend_utc: null,
            },
          ],
          price: 0,
          food: [],
          registration: false,
          source_image_url: null,
          category: "Career",
          organization: "UW Tech Club",
          organization_type: "wusa",
          school: "uwaterloo",
          cancelled: false,
          added_at: new Date().toISOString(),
        }),
      });
    });

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]').click();

    const eventDrawer = page.getByRole("dialog", { name: "Tech Career Fair" });
    const drawerActions = eventDrawer.locator('[data-slot="event-actions"]');
    await expect(drawerActions.getByRole("button").nth(0)).toHaveText("Edit");
    await expect(drawerActions.getByRole("button").nth(1)).toHaveText("Delete");

    await drawerActions.getByRole("button", { name: "Delete" }).click();
    const drawerDeleteDialog = page.getByRole("dialog", { name: "Delete Event" });
    await expect(drawerDeleteDialog).toContainText(
      'Are you sure you want to delete "Tech Career Fair"?',
    );
    await drawerDeleteDialog.getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await expect(eventDrawer).not.toBeVisible();

    await page.goto(`${BASE}/events/1`);
    const pageActions = page.locator('[data-slot="event-actions"]');
    await expect(pageActions.getByRole("button").nth(0)).toHaveText("Edit");
    await expect(pageActions.getByRole("button").nth(1)).toHaveText("Delete");

    await pageActions.getByRole("button", { name: "Delete" }).click();
    const pageDeleteDialog = page.getByRole("dialog", { name: "Delete Event" });
    await pageDeleteDialog.getByRole("button", { name: "Delete" }).click();

    await expect.poll(() => deleteRequests).toBe(1);
    await expect(page).toHaveURL(`${BASE}/`);
  });

  test("scrolls drawer content that exceeds the mobile viewport", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.setViewportSize({ width: 375, height: 320 });
    await page.goto(BASE);

    const card = page.locator('article[data-event-id="1"]').first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.getByRole("dialog", { name: "Tech Career Fair" })
      .getByRole("button", { name: "Report" })
      .click();

    const drawer = page.getByRole("dialog", { name: /Report event/i });
    const drawerBody = drawer.locator('[data-slot="drawer-body"]');
    await expect(drawerBody).toBeVisible();
    await expect(drawer.locator('[data-slot="drawer-doodle-field"]')).toHaveCount(0);
    await expect
      .poll(() =>
        drawerBody.evaluate(
          element => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);

    await drawerBody.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => drawerBody.evaluate(element => element.scrollTop))
      .toBeGreaterThan(0);
  });

  test("scrolls and closes event details opened from a card", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 320 });
    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]').click();

    const drawer = page.getByRole("dialog");
    const drawerBody = drawer.locator('[data-slot="drawer-body"]');
    await expect(drawer).toBeVisible();
    await expect(drawerBody).toHaveCount(1);
    await expect
      .poll(() =>
        drawerBody.evaluate(
          element => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);

    await drawerBody.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => drawerBody.evaluate(element => element.scrollTop))
      .toBeGreaterThan(0);

    const closedSynchronously = await page
      .getByRole("button", { name: "Close" })
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
        return (
          document
            .querySelector('[data-slot="drawer-content"]')
            ?.getAttribute("data-state") !== "open"
        );
      });

    expect(closedSynchronously).toBe(true);
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("shows similar events below a dedicated event page", async ({ page }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    const eventDetails = [
      {
        id: 1,
        organization_id: 1,
        title: "Tech Career Fair",
        description: "Meet campus employers.",
        location: "SLC",
        occurrences: [
          {
            id: 1,
            event_id: 1,
            dtstart_utc: startsAt,
            dtend_utc: null,
          },
        ],
        price: 0,
        food: [],
        registration: false,
        source_image_url: null,
        organization_type: "independent",
        school: "uwaterloo",
        source_url: null,
        category: "Career",
        organization: "UW Tech Club",
        ig_handle: null,
        cancelled: false,
        added_at: now.toISOString(),
      },
      {
        id: 2,
        organization_id: 2,
        title: "Board Game Night",
        description: "Play board games with other students.",
        location: "MC",
        occurrences: [
          {
            id: 2,
            event_id: 2,
            dtstart_utc: startsAt,
            dtend_utc: null,
          },
        ],
        price: 0,
        food: [],
        registration: false,
        source_image_url: null,
        organization_type: "independent",
        school: "uwaterloo",
        source_url: null,
        category: "Social",
        organization: "UW Board Games Club",
        ig_handle: null,
        cancelled: false,
        added_at: now.toISOString(),
      },
    ];

    await page.route(
      (url) => ["/events/1", "/events/2"].includes(apiPath(url) ?? ""),
      async (route) => {
        const id = Number(apiPath(new URL(route.request().url()))?.split("/").pop());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(eventDetails.find((event) => event.id === id)),
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
            items: eventDetails,
            total: eventDetails.length,
            page: 1,
            page_size: 100,
            total_pages: 1,
            latest_added_event: null,
          }),
        });
      },
    );

    await page.goto(`${BASE}/events/1`);

    await expect(
      page.getByRole("heading", { name: "Similar Events" }),
    ).toBeVisible();
    const similarEvent = page.getByRole("button", {
      name: "Event: Board Game Night",
    });
    await expect(similarEvent).toBeVisible();
    await similarEvent.click();

    await expect(page).toHaveURL(`${BASE}/events/2`);
    await expect(
      page.getByRole("heading", { name: "Board Game Night", level: 1 }),
    ).toBeVisible();
  });

  test("renders event facts and completes signed-out registration inline", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    let registrationBody: { occurrence_ids: string[] } | null = null;

    await page.route(url => apiPath(url) === "/auth/send-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "sent" }),
      });
    });
    await page.route(url => apiPath(url) === "/auth/verify-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "inline-registration-token",
          token_type: "bearer",
          expires_in: 3600,
          user_id: "inline-registration-user",
          school: "uwaterloo",
          onboarding_required: false,
        }),
      });
    });
    await page.route(url => apiPath(url) === "/users/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "inline-registration-user",
          email: TEST_EMAIL,
          full_name: "Inline Student",
          avatar_url: null,
          faculty: null,
          school: "uwaterloo",
          interests: [],
          is_first_year: false,
          role: "user",
          payout_email: null,
          promoter_tos_accepted_at: null,
          promoter_tos_version: null,
        }),
      });
    });
    await page.route(url => apiPath(url) === "/organizations/mine", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route(url => apiPath(url) === "/going-events/1", async (route) => {
      registrationBody = route.request().postDataJSON() as {
        occurrence_ids: string[];
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "going",
          event_id: 1,
          occurrence_ids: registrationBody.occurrence_ids,
          going_count: 1,
        }),
      });
    });
    await page.route(url => apiPath(url) === "/events/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          organization_id: 1,
          title: "Tech Career Fair",
          description: "Full detail loaded",
          location: "SLC",
          occurrences: [{
            id: "occurrence-1",
            event_id: 1,
            dtstart_utc: startsAt,
            dtend_utc: null,
          }],
          price: 0,
          food: [],
          registration: true,
          source_image_url: null,
          organization_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: "Career",
          organization: "UW Tech Club",
          ig_handle: null,
          cancelled: false,
          added_at: now.toISOString(),
        }),
      });
    });

    const assertEventDetails = async () => {
      const facts = page.locator('[data-slot="form-grid"]').first();
      await expect
        .poll(() =>
          facts.evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
        )
        .toBe(2);

      const map = page.locator('iframe[title="SLC"]');
      await expect(map).toBeVisible();
      const mapSrc = await map.getAttribute("src");
      expect(mapSrc).not.toBeNull();
      expect(new URL(mapSrc!).searchParams.get("q")).toBe(
        "SLC, University of Waterloo",
      );
      expect(
        await map.evaluate(
          (element) =>
            element.previousElementSibling?.querySelector("h3")?.textContent,
        ),
      ).toBe("About Event");
    };

    const assertInlineRegistration = async () => {
      const authForm = page.getByTestId("event-registration-auth");
      const emailInput = authForm.getByLabel("Email address");
      await expect(emailInput).toBeVisible();
      await expect(emailInput).toHaveAttribute(
        "placeholder",
        "you@uwaterloo.ca",
      );
      await expect(
        authForm.getByRole("button", { name: "Register", exact: true }),
      ).toBeDisabled();
    };

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]').click();
    await assertEventDetails();
    await assertInlineRegistration();

    await page.goto(`${BASE}/events/1`);
    await assertEventDetails();
    await assertInlineRegistration();

    const authForm = page.getByTestId("event-registration-auth");
    const registerButton = authForm.getByRole("button", {
      name: "Register",
      exact: true,
    });
    await authForm.getByLabel("Email address").fill(TEST_EMAIL);
    await expect(registerButton).toBeEnabled();
    await registerButton.click();

    await expect(authForm.getByLabel("Verification code")).toBeVisible();
    await expect(registerButton).toBeDisabled();
    await authForm.getByLabel("Verification code").fill("123456");
    await expect(registerButton).toBeEnabled();
    await registerButton.click();

    await expect.poll(() => registrationBody).toEqual({
      occurrence_ids: ["occurrence-1"],
    });
    await expect(page.getByText("You're In")).toBeVisible();
  });

  test("shows New in the top-left without an event category badge", async ({ page }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    await page.route(url => apiPath(url) === "/meta/constants", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event_categories: ["Arts & Culture"],
          organization_categories: ["Arts & Culture"],
          interests: ["Arts & Culture"],
          interest_to_categories: { "Arts & Culture": ["Arts & Culture"] },
          report_statuses: ["pending", "resolved", "dismissed"],
        }),
      });
    });
    await page.route(url => apiPath(url) === "/events/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          organization_id: 1,
          title: "Tech Career Fair",
          description: "Full detail loaded",
          location: "SLC",
          occurrences: [{ id: 1, event_id: 1, dtstart_utc: startsAt, dtend_utc: null }],
          price: 0,
          food: [],
          registration: false,
          source_image_url: null,
          organization_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: null,
          organization: "UW Tech Club",
          ig_handle: null,
          cancelled: false,
          added_at: now.toISOString(),
        }),
      });
    });

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]').click();

    const drawer = page.getByRole("dialog", { name: "Tech Career Fair" });
    await expect(drawer.getByText("Full detail loaded", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Arts & Culture", { exact: true })).toHaveCount(0);
    const newBadge = drawer.getByText("New", { exact: true });
    await expect(newBadge).toBeVisible();
    await expect(
      newBadge.locator("xpath=ancestor::div[contains(@class, 'absolute')][1]"),
    ).toHaveClass(/top-0.*left-0/);
  });

  test("uses recurring-event controls above the event drawer", async ({ page }) => {
    await seedAuthenticatedSession(page);

    const firstOccurrenceId = "11111111-1111-4111-8111-111111111111";
    const secondOccurrenceId = "22222222-2222-4222-8222-222222222222";
    const firstStartsAt = "2030-08-10T18:00:00Z";
    const secondStartsAt = "2030-08-17T18:00:00Z";
    let submittedOccurrenceIds: string[] | null = null;

    await page.route(url => apiPath(url) === "/events/1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          organization_id: 1,
          title: "Recurring Workshop",
          description: "Choose one workshop date",
          location: "SLC",
          occurrences: [
            {
              id: firstOccurrenceId,
              event_id: 1,
              dtstart_utc: firstStartsAt,
              dtend_utc: null,
            },
            {
              id: secondOccurrenceId,
              event_id: 1,
              dtstart_utc: secondStartsAt,
              dtend_utc: null,
            },
          ],
          price: 0,
          food: [],
          registration: true,
          source_image_url: null,
          organization_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: "Career",
          organization: "UW Tech Club",
          ig_handle: null,
          cancelled: false,
          added_at: new Date().toISOString(),
        }),
      });
    });
    await page.route(url => apiPath(url) === "/going-events/1", async (route) => {
      const body = route.request().postDataJSON() as {
        occurrence_ids: string[];
      };
      submittedOccurrenceIds = body.occurrence_ids;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "going",
          event_id: 1,
          occurrence_ids: body.occurrence_ids,
          going_count: 1,
        }),
      });
    });

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]').click();

    const drawer = page.getByRole("dialog", { name: "Recurring Workshop" });
    const extraDatesButton = drawer.getByRole("button", { name: "+1 date" });
    await extraDatesButton.hover();

    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await expect(tooltip).toBeVisible();
    const [tooltipZIndex, drawerZIndex] = await Promise.all([
      tooltip.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
      drawer.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
    ]);
    expect(tooltipZIndex).toBeGreaterThan(drawerZIndex);

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await extraDatesButton.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
    });
    await extraDatesButton.dispatchEvent("pointerup", {
      pointerType: "touch",
      isPrimary: true,
    });
    await extraDatesButton.dispatchEvent("click");
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");

    await drawer.getByRole("button", { name: "Register", exact: true }).click();

    const occurrenceSelect = drawer.getByRole("combobox", {
      name: "Which time are you going?",
    });
    await expect(occurrenceSelect).toBeVisible();
    await expect(occurrenceSelect).toHaveAttribute("data-slot", "select-trigger");
    await expect(drawer.locator('input[type="checkbox"]')).toHaveCount(0);

    const secondLabel = new Intl.DateTimeFormat("en", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(secondStartsAt));

    await occurrenceSelect.click();
    await page.getByRole("option", { name: secondLabel }).click();
    await drawer.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect.poll(() => submittedOccurrenceIds).toEqual([secondOccurrenceId]);
  });

  test("omits zero stats and abbreviates card weekdays", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const card = page.locator("article[data-event-id]").first();
    await expect(card).toBeVisible();
    await expect(card).not.toContainText(/\b0 clicks?\b/);
    await expect(card).not.toContainText(/\b0 going\b/);
    const cardContent = card.locator('[data-slot="event-card-content"]');
    const contentStack = cardContent.locator(":scope > div");
    await expect(cardContent).toHaveCSS("padding-top", "10px");
    await expect(contentStack).toHaveCSS("row-gap", "0px");
    await expect(contentStack.locator(":scope > div").nth(1)).toHaveCSS(
      "margin-top",
      "0px",
    );
    await expect(
      card.getByText(/^(?:Sun|Mon|Tues|Wed|Thur|Fri|Sat) [A-Z][a-z]{2} \d{1,2}$/),
    ).toBeVisible();
  });

  test("persists optimistic click and going stats across refresh", async ({ page }) => {
    await seedAuthenticatedSession(page);

    let clickCount = 0;
    let goingCount = 0;
    let isGoing = false;
    let eventId: number | null = null;

    await page.route(url => apiPath(url) === "/events/stats", async (route) => {
      const hasStats = clickCount > 0 || goingCount > 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          hasStats && eventId !== null
            ? { [eventId]: { click_count: clickCount, going_count: goingCount } }
            : {},
        ),
      });
    });
    await page.route(url => apiPath(url) === "/going-events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(isGoing && eventId !== null ? [eventId] : []),
      });
    });
    await page.route(url => apiPath(url)?.startsWith("/going-events/") === true, async (route) => {
      isGoing = route.request().method() === "PUT";
      goingCount = isGoing ? 1 : 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: isGoing ? "going" : "not_going",
          going_count: goingCount,
        }),
      });
    });
    await page.route(url => apiPath(url) === "/interactions/batch", async (route) => {
      const payload = route.request().postDataJSON() as {
        interactions?: Array<{ event_id: number; interaction_type: string }>;
      };
      clickCount +=
        payload.interactions?.filter(
          (interaction) =>
            interaction.event_id === eventId && interaction.interaction_type === "click",
        ).length ?? 0;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ recorded: payload.interactions?.length ?? 0 }),
      });
    });

    await page.goto(BASE);
    const card = page.locator("article[data-event-id]").first();
    await expect(card).toBeVisible();
    eventId = Number(await card.getAttribute("data-event-id"));
    expect(eventId).toBeGreaterThan(0);

    await card.getByRole("button", { name: "Going" }).click();
    await expect(card).toContainText("1 going");

    await card.click();
    await expect(card).toContainText("1 click · 1 going");

    await page.reload();
    const refreshedCard = page.locator(`article[data-event-id="${eventId}"]`).first();
    await expect(refreshedCard).toContainText("1 click · 1 going");
  });

  test("cuts out and drag-scrolls overflowing quick filters", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);

    const strip = page.getByTestId("event-quick-filter-scroll");
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("button", { name: "Career", exact: true })).toBeVisible();
    await expect.poll(() =>
      strip.evaluate((element) => getComputedStyle(element).maskImage)
    ).toContain("linear-gradient");
    await expect(strip).toHaveCSS("background-image", "none");
    const box = await strip.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(strip.locator('button[aria-pressed="true"]')).toHaveCount(0);

    await strip.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() =>
      strip.evaluate((element) => getComputedStyle(element).maskImage)
    ).toBe("none");
  });

  test("uses a clearable select for newly added events", async ({ page }) => {
    await page.goto(BASE);

    const newlyAddedSelect = page.getByRole("combobox", {
      name: "New",
    });
    await expect(newlyAddedSelect).toHaveAttribute("data-slot", "select-trigger");
    const freeFoodFilter = page.getByRole("button", {
      name: "Free food",
      exact: true,
    });
    const [selectStyles, buttonStyles] = await Promise.all(
      [newlyAddedSelect, freeFoodFilter].map((control) =>
        control.evaluate((element) => {
          const styles = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return {
            backgroundColor: styles.backgroundColor,
            borderTopWidth: styles.borderTopWidth,
            borderRadius: styles.borderRadius,
            color: styles.color,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            height: bounds.height,
            paddingLeft: styles.paddingLeft,
            paddingRight: styles.paddingRight,
          };
        }),
      ),
    );
    expect(selectStyles).toEqual(buttonStyles);
    expect(selectStyles.borderTopWidth).toBe("1px");

    await newlyAddedSelect.click();
    await expect(
      page.getByRole("option", { name: "New" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Added since last visit" }),
    ).toHaveCount(0);

    await page
      .getByRole("option", { name: "New" })
      .click();

    const clearNewlyAddedFilter = page.getByRole("button", {
      name: "Clear newly added filter",
    });
    await expect(clearNewlyAddedFilter).toHaveAttribute(
      "data-slot",
      "filter-clear-button",
    );
    await expect(clearNewlyAddedFilter).toHaveClass(/h-5/);
    await expect(clearNewlyAddedFilter).toContainText("1");
    const [selectBounds, clearBounds] = await Promise.all([
      newlyAddedSelect.boundingBox(),
      clearNewlyAddedFilter.boundingBox(),
    ]);
    expect(selectBounds).not.toBeNull();
    expect(clearBounds).not.toBeNull();
    if (selectBounds && clearBounds) {
      expect(
        selectBounds.x +
          selectBounds.width -
          (clearBounds.x + clearBounds.width),
      ).toBe(4);
    }

    await clearNewlyAddedFilter.hover();
    await expect
      .poll(() =>
        clearNewlyAddedFilter.evaluate((element) => {
          const backgroundColor = getComputedStyle(element).backgroundColor;
          const functionalAlpha = backgroundColor.match(
            /\/\s*([\d.]+)\s*\)$/,
          )?.[1];
          const rgbaAlpha = backgroundColor.match(
            /^rgba\(.*,\s*([\d.]+)\)$/,
          )?.[1];
          return Number(functionalAlpha ?? rgbaAlpha ?? 1);
        }),
      )
      .toBeCloseTo(0.28, 2);

    const newBadges = page.getByText("NEW", { exact: true });
    await expect.poll(() => newBadges.count()).toBeGreaterThan(0);
    const newBadge = newBadges.first();
    await expect(newBadge).toBeVisible();
    await expect
      .poll(() =>
        newBadge.evaluate((element) => ({
          backgroundColor: getComputedStyle(element).backgroundColor,
          color: getComputedStyle(element).color,
        })),
      )
      .toEqual({
        backgroundColor: "rgb(91, 155, 255)",
        color: "rgb(255, 255, 255)",
      });

    await clearNewlyAddedFilter.click();
    await expect(clearNewlyAddedFilter).toHaveCount(0);
  });

  test("filters events by preset or custom date from the quick-filter strip", async ({
    page,
  }) => {
    await page.goto(BASE);

    const dateFilter = page.getByRole("combobox", { name: "Event date" });
    await expect(dateFilter.locator("svg")).toHaveCount(0);
    const freeFoodFilter = page.getByRole("button", {
      name: "Free food",
      exact: true,
    });
    const [freeFoodBounds, dateFilterBounds] = await Promise.all([
      freeFoodFilter.boundingBox(),
      dateFilter.boundingBox(),
    ]);
    expect(freeFoodBounds).not.toBeNull();
    expect(dateFilterBounds).not.toBeNull();
    if (freeFoodBounds && dateFilterBounds) {
      expect(dateFilterBounds.x).toBeGreaterThan(freeFoodBounds.x);
    }

    await dateFilter.click();
    for (const option of [
      "Any day",
      "Today",
      "Tomorrow",
      "This week",
      "This weekend",
      "Next week",
      "Custom",
    ]) {
      await expect(page.getByRole("option", { name: option })).toBeVisible();
    }
    await page.getByRole("option", { name: "Today" }).click();
    await expect(page.getByText("Tech Career Fair", { exact: true })).toHaveCount(0);

    await dateFilter.click();
    await page.getByRole("option", { name: "Tomorrow" }).click();
    await expect(page.getByText("Tech Career Fair", { exact: true })).toBeVisible();

    await dateFilter.click();
    await page.getByRole("option", { name: "Custom" }).click();
    await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
    const tomorrowDataDay = await page.evaluate(() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toLocaleDateString();
    });
    await page.locator(`button[data-day="${tomorrowDataDay}"]`).click();

    await expect(dateFilter).not.toContainText("Custom");
    await expect(page.getByText("Tech Career Fair", { exact: true })).toBeVisible();
  });

  test("renders borderless event card content without horizontal padding", async ({
    page,
  }) => {
    await page.goto(BASE);

    const card = page.locator("article[data-event-id]").first();
    const frame = card.locator('[data-slot="event-card-content-frame"]');
    const content = frame.locator('[data-slot="event-card-content"]');
    await expect(frame).toBeVisible();
    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            backgroundColor: styles.backgroundColor,
            borderTopWidth: styles.borderTopWidth,
            borderRightWidth: styles.borderRightWidth,
            borderBottomWidth: styles.borderBottomWidth,
            borderLeftWidth: styles.borderLeftWidth,
          };
        }),
      )
      .toEqual({
        backgroundColor: "rgba(0, 0, 0, 0)",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        borderLeftWidth: "0px",
      });
    await expect(content).toHaveCSS("padding-left", "0px");
    await expect(content).toHaveCSS("padding-right", "0px");

    const organizationBadge = card.locator('[data-slot="organization-badge"]');
    await expect(organizationBadge).toHaveCSS("opacity", "1");
    await card.hover();
    await expect(card).toHaveCSS("opacity", "1");
    await expect(organizationBadge).toHaveCSS("opacity", "1");
    await expect(
      card.locator('xpath=ancestor::*[@data-slot="card-grid"]'),
    ).toHaveCSS("column-gap", "20px");
  });

  test("rounds the event card image's bottom-right corner", async ({ page }) => {
    await page.goto(BASE);

    const cardImage = page
      .locator(
        'article[data-event-id] [data-slot="event-card-image"][data-variant="card"]',
      )
      .first();
    await expect(cardImage).toBeVisible();
    await expect(cardImage).toHaveCSS("border-bottom-right-radius", "12px");
  });

  test("keeps chronological ordering when client-side filters change", async ({
    page,
  }) => {
    const now = Date.now();
    const event = (
      id: number,
      title: string,
      startsInDays: number,
      addedHoursAgo: number,
    ) => ({
      id,
      title,
      location: "SLC",
      occurrences: [
        {
          id,
          event_id: id,
          dtstart_utc: new Date(now + startsInDays * 86_400_000).toISOString(),
          dtend_utc: null,
        },
      ],
      price: 0,
      food: [],
      registration: false,
      source_image_url: null,
      category: "Career",
      organization_id: 1,
      organization: "UW Tech Club",
      organization_type: "wusa",
      organization_page: null,
      organization_ig: "uwtechclub",
      organization_discord: null,
      school: "uwaterloo",
      added_at: new Date(now - addedHoursAgo * 3_600_000).toISOString(),
    });
    const chronologicalEvents = [
      event(11, "Soon Event", 1, 3),
      event(12, "Middle Event", 2, 2),
      event(13, "Later Event", 3, 1),
    ];

    await page.route(url => apiPath(url) === "/events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: chronologicalEvents,
          total: chronologicalEvents.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
          latest_added_event: {
            title: "Later Event",
            added_at: chronologicalEvents[2].added_at,
          },
        }),
      });
    });

    await page.goto(BASE);
    const cards = page.locator("article[data-event-id]");
    await expect(cards).toHaveCount(3);

    const newlyAddedSelect = page.getByRole("combobox", { name: "New" });
    await newlyAddedSelect.click();
    await page.getByRole("option", { name: "New" }).click();

    await expect
      .poll(() =>
        cards.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("aria-label")),
        ),
      )
      .toEqual([
        "Event: Soon Event",
        "Event: Middle Event",
        "Event: Later Event",
      ]);
  });

  test("anchors badge mask fillets to the intended image offsets", async ({
    page,
  }) => {
    await page.goto(BASE);

    const newBadges = page.getByText("NEW", { exact: true });
    await expect.poll(() => newBadges.count()).toBeGreaterThan(0);
    const newBadge = newBadges.first();
    const geometry = await newBadge.evaluate((element) => {
      const card = element.closest("article[data-event-card]");
      const mask = card?.querySelector("mask");
      const svg = mask?.ownerSVGElement;
      const viewBox = svg?.viewBox.baseVal;
      const svgBounds = svg?.getBoundingClientRect();
      const badgeBounds = element.getBoundingClientRect();
      const organizationBadgeBounds = card
        ?.querySelector('[data-slot="organization-badge"]')
        ?.getBoundingClientRect();
      const groups = Array.from(mask?.querySelectorAll(":scope > g") ?? []);
      const topLeftGroup = groups.find((group) => {
        const rect = group.querySelector(":scope > rect");
        return (
          Number(rect?.getAttribute("x")) < 0 &&
          Number(rect?.getAttribute("y")) < 0
        );
      });
      const topLeftRect = topLeftGroup?.querySelector(":scope > rect");
      const topLeftFillets = Array.from(
        topLeftGroup?.querySelectorAll(":scope > svg") ?? [],
      ).map((fillet) => ({
        x: Number(fillet.getAttribute("x")),
        y: Number(fillet.getAttribute("y")),
      }));
      const topSideFillet = topLeftFillets.toSorted(
        (a, b) => b.x - a.x,
      )[0];
      const topBottomFillet = topLeftFillets.toSorted(
        (a, b) => b.y - a.y,
      )[0];
      const bottomLeftGroup = groups.find((group) => {
        const rect = group.querySelector(":scope > rect");
        return (
          Number(rect?.getAttribute("x")) < 0 &&
          Number(rect?.getAttribute("y")) > 0
        );
      });
      const bottomLeftRect = bottomLeftGroup?.querySelector(":scope > rect");
      const bottomLeftFillets = Array.from(
        bottomLeftGroup?.querySelectorAll(":scope > svg") ?? [],
      )
        .map((fillet) => ({
          x: Number(fillet.getAttribute("x")),
          y: Number(fillet.getAttribute("y")),
          width: Number(fillet.getAttribute("width")),
          height: Number(fillet.getAttribute("height")),
        }))
        .toSorted((a, b) => b.y - a.y);
      const bottomSideFillet = bottomLeftFillets[0];
      const bottomTopFillet = bottomLeftFillets.at(-1);
      const scaleX = svgBounds && viewBox ? svgBounds.width / viewBox.width : 0;
      const scaleY =
        svgBounds && viewBox ? svgBounds.height / viewBox.height : 0;
      const cutoutRight =
        (svgBounds?.left ?? 0) +
        (Number(topLeftRect?.getAttribute("x")) +
          Number(topLeftRect?.getAttribute("width"))) *
          scaleX;
      const cutoutBottom =
        (svgBounds?.top ?? 0) +
        (Number(topLeftRect?.getAttribute("y")) +
          Number(topLeftRect?.getAttribute("height"))) *
          scaleY;
      const bottomCutoutRight =
        (svgBounds?.left ?? 0) +
        (Number(bottomLeftRect?.getAttribute("x")) +
          Number(bottomLeftRect?.getAttribute("width"))) *
          scaleX;
      const bottomCutoutTop =
        (svgBounds?.top ?? 0) +
        Number(bottomLeftRect?.getAttribute("y")) * scaleY;
      const bottomFilletEdgeOffsets = groups
        .map((group) => ({
          rectY: Number(group.querySelector(":scope > rect")?.getAttribute("y")),
          filletYs: Array.from(group.querySelectorAll(":scope > svg")).map(
            (fillet) => Number(fillet.getAttribute("y")),
          ),
        }))
        .filter(({ rectY }) => rectY > 0)
        .map(
          ({ filletYs }) =>
            ((viewBox?.height ?? 0) - Math.max(...filletYs)) * scaleY,
        );

      return {
        topLeftRightGap: cutoutRight - badgeBounds.right,
        topLeftBottomGap: cutoutBottom - badgeBounds.bottom,
        topSideFilletOverlap:
          (Number(topLeftRect?.getAttribute("x")) +
            Number(topLeftRect?.getAttribute("width")) -
            (topSideFillet?.x ?? 0)) *
          scaleX,
        topBottomFilletOverlap:
          (Number(topLeftRect?.getAttribute("y")) +
            Number(topLeftRect?.getAttribute("height")) -
            (topBottomFillet?.y ?? 0)) *
          scaleY,
        bottomLeftRightGap:
          bottomCutoutRight - (organizationBadgeBounds?.right ?? 0),
        bottomLeftTopGap:
          (organizationBadgeBounds?.top ?? 0) - bottomCutoutTop,
        bottomSideFilletOverlap:
          (Number(bottomLeftRect?.getAttribute("x")) +
            Number(bottomLeftRect?.getAttribute("width")) -
            (bottomSideFillet?.x ?? 0)) *
          scaleX,
        bottomTopFilletOverlap:
          ((bottomTopFillet?.y ?? 0) +
            (bottomTopFillet?.height ?? 0) -
            Number(bottomLeftRect?.getAttribute("y"))) *
          scaleY,
        bottomFilletEdgeOffsets,
      };
    });

    expect(geometry.topLeftRightGap).toBeCloseTo(6, 0);
    expect(geometry.topLeftBottomGap).toBeCloseTo(2, 0);
    expect(geometry.topSideFilletOverlap).toBeCloseTo(0.25, 2);
    expect(geometry.topBottomFilletOverlap).toBeCloseTo(0.25, 2);
    expect(geometry.bottomLeftRightGap).toBeCloseTo(4, 0);
    expect(geometry.bottomLeftTopGap).toBeCloseTo(4, 0);
    expect(geometry.bottomSideFilletOverlap).toBeCloseTo(0.25, 2);
    expect(geometry.bottomTopFilletOverlap).toBeCloseTo(0.25, 2);
    expect(geometry.bottomFilletEdgeOffsets).toHaveLength(1);
    for (const edgeOffset of geometry.bottomFilletEdgeOffsets) {
      expect(edgeOffset).toBeCloseTo(8, 0);
    }
  });

  test("offers events added since the last visit only when signed in", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    const previousVisitAt = new Date(
      Date.now() - 7 * 86_400_000,
    ).toISOString();
    await page.addInitScript(
      ({ storageKey, visitKey, timestamp }) => {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ [visitKey]: timestamp }),
        );
      },
      {
        storageKey: STORAGE_KEYS.EVENT_VISITS,
        visitKey: `${TEST_EMAIL}:uwaterloo`,
        timestamp: previousVisitAt,
      },
    );

    await page.goto(BASE);

    const newlyAddedSelect = page.getByRole("combobox", {
      name: "New",
    });
    await newlyAddedSelect.click();
    await page
      .getByRole("option", { name: "Added since last visit" })
      .click();

    await expect(
      page.getByRole("combobox", { name: "Added since last visit" }),
    ).toBeVisible();
    await expect
      .poll(() => page.locator("article[data-event-id]").count())
      .toBeGreaterThan(0);
  });

  test("keeps view mode separate from active filters", async ({ page }) => {
    await page.goto(BASE);
    await expect(
      page.getByRole("button", { name: "Arts & Culture", exact: true }),
    ).toBeVisible();

    const moreFiltersButton = page.getByRole("button", { name: "More filters" });
    await moreFiltersButton.click();

    const drawer = page.getByRole("dialog", { name: "More filters" });
    const gridButton = drawer.getByRole("button", { name: "Grid" });
    const calendarButton = drawer.getByRole("button", { name: "Calendar" });
    const categoryButton = drawer.getByRole("button", {
      name: "Arts & Culture",
    });

    await expect(calendarButton).toHaveClass(/bg-background/);
    await expect(categoryButton).toHaveClass(/bg-background/);
    await expect(categoryButton).toHaveClass(/border-border\/60/);
    await expect(gridButton).toHaveClass(/bg-primary/);

    const categoryBoundsBeforeSelection = await categoryButton.boundingBox();
    expect(categoryBoundsBeforeSelection).not.toBeNull();

    await calendarButton.click();
    await expect(calendarButton).toHaveClass(/bg-primary/);
    await expect(gridButton).toHaveClass(/bg-background/);
    await expect(
      drawer.getByRole("button", { name: "Clear View" }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Clear filters" }),
    ).toHaveCount(0);

    await moreFiltersButton.click();
    await categoryButton.click();
    await expect(categoryButton).toHaveClass(/bg-primary/);
    const categoryBoundsAfterSelection = await categoryButton.boundingBox();
    expect(categoryBoundsAfterSelection).not.toBeNull();
    if (categoryBoundsBeforeSelection && categoryBoundsAfterSelection) {
      expect(categoryBoundsAfterSelection.width).toBe(
        categoryBoundsBeforeSelection.width,
      );
      expect(categoryBoundsAfterSelection.height).toBe(
        categoryBoundsBeforeSelection.height,
      );
    }

    await page.keyboard.press("Escape");
    const clearFiltersButton = page.getByRole("button", {
      name: "Clear filters",
    });
    await expect(clearFiltersButton).toHaveAttribute(
      "data-slot",
      "filter-clear-button",
    );
    await expect(clearFiltersButton).toHaveClass(/h-5/);
    await expect(clearFiltersButton).toContainText("1");
    await clearFiltersButton.click();
    await expect(clearFiltersButton).toHaveCount(0);
  });

  test("filters free-text fields and price range, then restores all events", async ({
    page,
  }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    const eventBase = {
      location: "SLC",
      occurrences: [
        {
          id: 1,
          event_id: 1,
          dtstart_utc: startsAt,
          dtend_utc: null,
        },
      ],
      price: 0,
      registration: false,
      source_image_url: null,
      category: "Career",
      organization: "UW Tech Club",
      organization_type: "wusa",
      school: "uwaterloo",
      added_at: now.toISOString(),
    };

    await page.route(url => apiPath(url) === "/events", async (route) => {
      const items = [
        {
          ...eventBase,
          id: 1,
          title: "Tech Career Fair",
          food: [],
        },
        {
          ...eventBase,
          id: 2,
          title: "Pizza Social",
          price: 12,
          food: ["Pizza", "Cookies"],
          organization: "Campus Food Society",
          occurrences: [
            {
              id: 2,
              event_id: 2,
              dtstart_utc: startsAt,
              dtend_utc: null,
            },
          ],
        },
        {
          ...eventBase,
          id: 3,
          title: "Campus Mixer",
          food: ["Yes!"],
          organization: "Student Life Club",
          occurrences: [
            {
              id: 3,
              event_id: 3,
              dtstart_utc: startsAt,
              dtend_utc: null,
            },
          ],
        },
      ];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          total: items.length,
          page: 1,
          page_size: 20,
          total_pages: 1,
          latest_added_event: {
            title: "Pizza Social",
            added_at: now.toISOString(),
          },
        }),
      });
    });

    await page.goto(BASE);
    await expect(page.locator("article[data-event-id]")).toHaveCount(3);
    const pizzaCard = page.locator('article[data-event-id="2"]');
    await expect(pizzaCard).toContainText("Pizza");
    await expect(pizzaCard).not.toContainText("Cookies");
    for (const label of ["$12", "Pizza"]) {
      await expect(pizzaCard.getByText(label, { exact: true })).toHaveClass(
        /text-\[11px\]/,
      );
    }
    const genericFoodCard = page.locator('article[data-event-id="3"]');
    await expect(genericFoodCard).toContainText("Food");
    await expect(genericFoodCard).not.toContainText("Yes!");

    await page.getByRole("button", { name: "More filters" }).click();
    const drawer = page.getByRole("dialog", { name: "More filters" });
    const foodInput = drawer.getByPlaceholder("Search food...");
    await foodInput.fill("piz");

    await expect(page.locator("article[data-event-id]")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();

    await foodInput.clear();
    await expect(page.locator("article[data-event-id]")).toHaveCount(3);

    const organizationInput = drawer.getByPlaceholder("Search organization...");
    await organizationInput.fill("food");
    await expect(page.locator("article[data-event-id]")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();
    await organizationInput.clear();
    await expect(page.locator("article[data-event-id]")).toHaveCount(3);

    const minPriceInput = drawer.getByRole("spinbutton", { name: "Min" });
    const maxPriceInput = drawer.getByRole("spinbutton", { name: "Max" });
    await minPriceInput.fill("1");
    await expect(page.locator("article[data-event-id]")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();
    await minPriceInput.clear();
    await maxPriceInput.fill("0");
    await expect(page.locator("article[data-event-id]")).toHaveCount(2);
    await maxPriceInput.clear();
    await expect(page.locator("article[data-event-id]")).toHaveCount(3);
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

  test("Instagram publishing collection stays on the app API origin", async ({ request }) => {
    const res = await request.get(
      `${APP_API}/instagram-publishing/batches/?page=1&page_size=100`,
      { maxRedirects: 0 },
    );

    expect(res.status()).toBe(401);
    expect(res.headers().location).toBeUndefined();
  });

  test("V1 saved-event collection stays on the app API origin", async ({ request }) => {
    const res = await request.get(`${APP_API}/v1/saved-events/`, {
      maxRedirects: 0,
    });

    expect(res.status()).toBe(401);
    expect(res.headers().location).toBeUndefined();
  });
});

// ── Workflow 3: Organizations Page ────────────────────────────────────

test.describe("Organizations Page", () => {
  test("loads and displays organizations", async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    const organizationCard = page.locator('[data-organization-id="1"]');
    const organizationContent = organizationCard.locator(
      '[data-slot="event-card-content"]',
    );
    const addClubButton = page.getByRole("button", {
      name: "Add club",
      exact: true,
    });
    const organizationSearch = page.getByPlaceholder("Search organizations...").locator("..");
    const organizationScope = page.getByRole("combobox", { name: "All", exact: true });
    await expect(
      page.getByRole("heading", { name: /clubs and student organizations/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/Explore student communities/i)).toHaveCount(0);
    await expect(addClubButton.locator("svg")).toHaveCount(0);
    await expect(
      organizationCard.getByRole("link", { name: "View Organization Page" }),
    ).toBeVisible();
    await expect(
      organizationCard.getByRole("button", { name: "More options" }),
    ).toHaveCount(0);
    await expect(organizationContent).toHaveCSS("padding-left", "12px");
    await expect(organizationContent).toHaveCSS("padding-right", "12px");
    await expect(
      organizationCard.locator('xpath=ancestor::*[@data-slot="card-grid"]'),
    ).toHaveCSS("column-gap", "20px");
    await expect
      .poll(async () => {
        const [
          searchBox,
          scopeBox,
          addClubBox,
          sharesSearchRow,
          scopeBesideCategoryStrip,
        ] = await Promise.all([
          organizationSearch.boundingBox(),
          organizationScope.boundingBox(),
          addClubButton.boundingBox(),
          organizationSearch.evaluate((searchElement) =>
            Boolean(
              !searchElement.parentElement?.querySelector(
                '[role="combobox"]',
              ) &&
              searchElement.parentElement
                ?.querySelector("button")
                ?.textContent?.includes("Add club"),
            ),
          ),
          page
            .getByTestId("organization-category-filter-scroll")
            .evaluate((strip) =>
              Boolean(
                strip.parentElement?.parentElement?.querySelector(
                  '[role="combobox"]',
                ),
              ),
            ),
        ]);
        return {
          searchHeight: searchBox?.height,
          scopeHeight: scopeBox?.height,
          addClubHeight: addClubBox?.height,
          sharesSearchRow,
          scopeBesideCategoryStrip,
        };
      })
      .toEqual({
        searchHeight: 44,
        scopeHeight: 32,
        addClubHeight: 44,
        sharesSearchRow: true,
        scopeBesideCategoryStrip: true,
      });

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
      data: {
        organization_name: "Test",
        organization_type: "independent",
        categories: ["Technology"],
      },
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

test.describe("Standalone submission pages", () => {
  test("stale session can still access event submission as anonymous", async ({
    page,
  }) => {
    await page.route(url => apiPath(url) === "/auth/refresh", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Session expired" }),
      });
    });
    await page.addInitScript(
      ({ emailKey, email }) => {
        window.localStorage.setItem(emailKey, JSON.stringify(email));
      },
      { emailKey: STORAGE_KEYS.USER_EMAIL, email: TEST_EMAIL },
    );

    await page.goto(`${BASE}/events/submit`);

    await expect(page).toHaveURL(`${BASE}/events/submit`);
    await expect(
      page.getByRole("heading", {
        name: "Submit Event",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Upload Event Flyer",
      }),
    ).toBeVisible();
  });

  test("anonymous visitor can parse an event flyer without session auth", async ({
    page,
  }) => {
    const portraitFlyerDataUrl = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#5b9bff"/></svg>',
    )}`;
    let parseAuthorization: string | null = null;
    let parseRequestCount = 0;
    await page.route(
      url => apiPath(url) === "/ai/parse-event-image",
      async (route) => {
        parseRequestCount += 1;
        parseAuthorization =
          route.request().headers()["authorization"] ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            organization_id: null,
            title: "Public Flyer Event",
            description: "",
            occurrences: [
              {
                dtstart_local: "2026-08-10T18:00",
                dtend_local: "2026-08-10T20:00",
              },
            ],
            location: "Student Life Centre",
            category: "Technology",
            price: 0,
            food: [],
            registration: false,
            source_image_url: portraitFlyerDataUrl,
          }),
        });
      },
    );

    await page.goto(`${BASE}/events/submit`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "oversized-event.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(MAX_IMAGE_UPLOAD_SIZE_BYTES + 1),
    });
    await expect(
      page.getByText("Image must be 5MB or smaller"),
    ).toBeVisible();
    expect(parseRequestCount).toBe(0);

    await page.locator('input[type="file"]').setInputFiles({
      name: "public-event.png",
      mimeType: "image/png",
      buffer: Buffer.from("event-image"),
    });

    await expect(page.locator("#field-title")).toHaveValue(
      "Public Flyer Event",
    );
    const posterPreview = page.getByRole("img", {
      name: "Poster Preview",
    });
    await expect(posterPreview).toBeVisible();
    const previewGeometry = await posterPreview.evaluate((image) => {
      const previewImage = image as HTMLImageElement;
      const bounds = previewImage.getBoundingClientRect();
      const containerBounds = previewImage.parentElement?.getBoundingClientRect();
      const styles = getComputedStyle(previewImage);
      return {
        containerWidth: containerBounds?.width ?? 0,
        height: bounds.height,
        maxHeight: styles.maxHeight,
        naturalAspectRatio:
          previewImage.naturalWidth / previewImage.naturalHeight,
        objectFit: styles.objectFit,
        renderedAspectRatio: bounds.width / bounds.height,
        width: bounds.width,
      };
    });
    expect(previewGeometry.objectFit).toBe("contain");
    expect(previewGeometry.maxHeight).toBe("672px");
    expect(previewGeometry.renderedAspectRatio).toBeCloseTo(
      previewGeometry.naturalAspectRatio,
      2,
    );
    expect(previewGeometry.width).toBeLessThanOrEqual(
      previewGeometry.containerWidth,
    );
    expect(previewGeometry.height).toBeLessThanOrEqual(672);
    expect(parseAuthorization).toBeNull();
    expect(parseRequestCount).toBe(1);
  });

  test("UTM hostname owns event and organization submission context", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    let requestedOrganizationSchool: string | null = null;

    await page.route(url => apiPath(url) === "/organizations", async (route) => {
      requestedOrganizationSchool = new URL(
        route.request().url(),
      ).searchParams.get("school");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              ...MOCK_ORGANIZATIONS[0],
              id: 91,
              organization_name: "UTM Campus Club",
              school: "utm",
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
          total_pages: 1,
        }),
      });
    });
    await page.route(
      url => apiPath(url) === "/ai/parse-event-image",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            organization_id: null,
            title: "UTM Test Event",
            description: "",
            occurrences: [
              {
                dtstart_local: "2026-08-10T18:00",
                dtend_local: "2026-08-10T20:00",
              },
            ],
            location: "Innovation Complex",
            category: "Technology",
            price: 0,
            food: [],
            registration: false,
            source_image_url: "/wat2do-logo.png",
          }),
        });
      },
    );

    const utmBase = "http://utm.localhost:3000";
    await page.goto(`${utmBase}/events/submit`);

    await expect(
      page.getByRole("heading", {
        name: "Submit Event",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Only organizations from University of Toronto Mississauga are shown",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.locator('input[type="file"]').setInputFiles({
      name: "utm-event.png",
      mimeType: "image/png",
      buffer: Buffer.from("event-image"),
    });

    await expect
      .poll(() => requestedOrganizationSchool)
      .toBe("utm");
    const organizationInput = page.getByRole("textbox", {
      name: "Organization",
    });
    await expect(organizationInput).toBeVisible();
    await organizationInput.fill("UTM Campus Club");
    await expect(organizationInput).toHaveValue("UTM Campus Club");
    await expect(
      page.getByText("UTM Campus Club", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Organization" }),
    ).toHaveCount(0);

    await page.goto(`${utmBase}/organizations/new`);
    await expect(
      page.getByRole("heading", {
        name: "Submit Organization",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This organization will be listed for University of Toronto Mississauga.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#club-school")).toHaveCount(0);
  });
});

// ── Workflow 6: Navigation ────────────────────────────────────────────

test.describe("Navigation", () => {
  test("Instagram admin route is present in the Next build", async ({ request }) => {
    const response = await request.get(`${BASE}/admin/instagram`);
    expect(response.status()).toBe(200);
  });

  test("renders the redesigned date-only Instagram cover", async ({ request }) => {
    const renderSecret = process.env.INSTAGRAM_SLIDE_RENDER_SECRET?.trim();
    const response = await request.post(`${BASE}/api/render-instagram-slide`, {
      headers: renderSecret
        ? { authorization: `Bearer ${renderSecret}` }
        : undefined,
      data: {
        kind: "cover",
        school: "utsg",
        local_date: "2026-07-27",
        new_event_count: 4,
        body: "Here are the 1 we like the most",
        events: [{ id: 1, school: "utsg", title: "Campus Event" }],
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const png = await response.body();
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.byteLength).toBeGreaterThan(50_000);
  });

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

  test("default and alternate school routes load without event feed errors", async ({ page }) => {
    const routes = [
      { url: BASE, schoolName: "University of Waterloo" },
      { url: `${BASE}/school/utsg`, schoolName: "University of Toronto" },
    ];

    for (const { url, schoolName } of routes) {
      await page.goto(url, { waitUntil: "domcontentloaded" });

      await expect(
        page.getByRole("banner").getByRole("button", { name: schoolName }),
      ).toBeVisible();
      await expect(page.getByText("Failed to load events. Please try again.")).toHaveCount(0);
      await expect(page.getByRole("main", { name: "Events list" })).toBeVisible();
    }
  });

  test("school options are available immediately from the client directory", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page
      .getByRole("banner")
      .getByRole("button", { name: "University of Waterloo" })
      .click();

    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "University of Waterloo" }),
    ).toBeVisible();
  });

  test("uses the top navigation and exposes poster help through About us", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const navigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    for (const linkName of [
      "Events",
      "Organizations",
      "Positions",
      "About us",
    ]) {
      await expect(
        navigation.getByRole("link", { name: linkName, exact: true }),
      ).toBeVisible();
    }
    const preferencesDivider = page.locator("[data-nav-preferences-divider]");
    await expect(preferencesDivider).toBeVisible();
    await expect(preferencesDivider).toHaveCSS("height", "24px");
    await expect(preferencesDivider).toHaveCSS("width", "1px");
    await expect(preferencesDivider).toHaveCSS("margin-left", "2px");
    await expect(preferencesDivider).toHaveCSS("margin-right", "6px");
    await expect(
      navigation.getByRole("link", { name: "Posters", exact: true }),
    ).toHaveCount(0);

    await navigation
      .getByRole("link", { name: "About us", exact: true })
      .click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByText("How you can help us", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Help with campus posters",
        exact: true,
      }),
    ).toHaveAttribute("href", "/promote");
  });

  test("moves compact navigation controls into the drawer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const topNavigation = page.getByRole("banner");
    await expect(
      topNavigation.getByRole("combobox").filter({ hasText: "English" }),
    ).toBeHidden();
    await expect(
      topNavigation.getByRole("button", { name: "Switch to dark mode" }),
    ).toBeHidden();
    await expect(
      topNavigation.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeHidden();

    await topNavigation
      .getByRole("button", { name: "Open navigation menu" })
      .click();

    const navigationDrawer = page.getByRole("dialog", {
      name: "Primary navigation",
    });
    await expect(
      navigationDrawer.getByText("Primary navigation", { exact: true }),
    ).toBeHidden();
    const drawerBody = navigationDrawer.locator('[data-slot="drawer-body"]');
    await expect(drawerBody).toHaveCSS("padding-top", "16px");
    await expect(
      drawerBody.getByRole("link", { name: "Go to events", exact: true }),
    ).toBeVisible();
    await expect(
      drawerBody.locator(":scope > [data-slot=separator]"),
    ).toHaveCount(2);
    await expect(
      drawerBody.locator(":scope > button").first(),
    ).toHaveText("Sign in");
    await expect(
      navigationDrawer.getByRole("link", { name: "Events", exact: true }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("combobox").filter({ hasText: "English" }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("button", { name: "Switch to dark mode" }),
    ).toBeVisible();
  });

  test("uses only the bottom-left page glow and no drawer decoration", async ({
    page,
  }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const background = page.locator('[data-slot="page-background"]');
    await expect(background.locator("img")).toHaveCount(0);
    await expect(background.locator(".page-doodle-grid")).toHaveCount(0);
    const backgroundImage = await background
      .locator(".bg-page-glow")
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(backgroundImage.match(/radial-gradient/g)).toHaveLength(1);

    await page
      .getByRole("button", { name: "More filters", exact: true })
      .click();
    await expect(page.locator('[data-slot="drawer-doodle-field"]')).toHaveCount(0);
  });

  test("theme toggle animates and persists through the shared theme cookie", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ themeKey }) => localStorage.setItem(themeKey, JSON.stringify("dark")),
      { themeKey: STORAGE_KEYS.THEME },
    );
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveClass(/dark/);
    const darkThemeToggle = page.getByRole("button", {
      name: "Switch to light mode",
    });
    const darkControlColors = await resolveThemeColors(page, ["--secondary"]);
    await expect(darkThemeToggle).toHaveCSS(
      "background-color",
      darkControlColors["--secondary"]!,
    );
    await expect(darkThemeToggle).toHaveCSS(
      "border-top-color",
      darkControlColors["--secondary"]!,
    );
    await page.evaluate(() => {
      const root = document.documentElement;
      const originalAnimate = root.animate.bind(root);
      root.animate = ((keyframes, options) => {
        const clipPath = (keyframes as PropertyIndexedKeyframes).clipPath;
        (
          window as typeof window & {
            __themeAnimation?: {
              clipPath: string[];
              transitionsLocked: boolean;
              pseudoElement: string | null;
            };
          }
        ).__themeAnimation = {
          clipPath: Array.isArray(clipPath)
            ? clipPath.map(String)
            : [String(clipPath)],
          transitionsLocked: root.classList.contains("no-transitions"),
          pseudoElement:
            typeof options === "object" && options
              ? (options.pseudoElement ?? null)
              : null,
        };
        return originalAnimate(keyframes, options);
      }) as typeof root.animate;
    });
    await darkThemeToggle.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    const lightThemeToggle = page.getByRole("button", {
      name: "Switch to dark mode",
    });
    const lightControlColors = await resolveThemeColors(page, [
      "--background",
      "--border",
    ]);
    await expect(lightThemeToggle).toHaveCSS(
      "background-color",
      lightControlColors["--background"]!,
    );
    await expect(lightThemeToggle).toHaveCSS(
      "border-top-color",
      lightControlColors["--border"]!,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __themeAnimation?: {
                  clipPath: string[];
                  transitionsLocked: boolean;
                  pseudoElement: string | null;
                };
              }
            ).__themeAnimation ?? null,
        ),
      )
      .toEqual({
        clipPath: [
          expect.stringMatching(/^circle\(0px at /),
          expect.stringMatching(/^circle\(.+px at /),
        ],
        transitionsLocked: true,
        pseudoElement: "::view-transition-new(root)",
      });
    await expect(page.locator("html")).not.toHaveClass(/no-transitions/);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          STORAGE_KEYS.THEME,
        ),
      )
      .toBe("light");
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const cookie = document.cookie
            .split("; ")
            .find((entry) => entry.startsWith(`${key}=`));
          return cookie ? decodeURIComponent(cookie.slice(key.length + 1)) : null;
        }, STORAGE_KEYS.THEME),
      )
      .toBe("light");

    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEYS.THEME);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          STORAGE_KEYS.THEME,
        ),
      )
      .toBe("dark");
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
