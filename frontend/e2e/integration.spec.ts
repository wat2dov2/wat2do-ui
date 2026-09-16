import { test } from "next/experimental/testmode/playwright.js";
import { expect, type Page } from "@playwright/test";
import type { NextFixture } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "../src/shared/constants/uploads";
import arTranslations from "../src/shared/locales/ar.json" with { type: "json" };

const BASE = "http://127.0.0.1:3000";
const APP_API = `${BASE}/api`;

/** Shared test identity used across auth-seeded tests. */
const TEST_EMAIL = "test@uwaterloo.ca";
const MOCK_SCHOOLS = [{
  slug: "uwaterloo", timezone: "America/Toronto", name: "University of Waterloo", primary_color: "#6b238e",
  secondary_color: "#ffd54f", email_domains: ["uwaterloo.ca"], language: "en",
  faculties: ["Arts", "Engineering", "Environment", "Health", "Mathematics", "Science"],
}, {
  slug: "utm", timezone: "America/Toronto", name: "University of Toronto Mississauga", primary_color: "#002A5C",
  secondary_color: "#FFFFFF", email_domains: ["utoronto.ca"], language: "en",
  faculties: ["Arts", "Science", "Management"],
}, {
  slug: "utsg", timezone: "America/Toronto", name: "University of Toronto", primary_color: "#002A5C",
  secondary_color: "#FFFFFF", email_domains: ["utoronto.ca"], language: "en",
  faculties: ["Arts and Science", "Engineering"],
}, {
  slug: "utsc", timezone: "America/Toronto", name: "University of Toronto Scarborough", primary_color: "#002A5C",
  secondary_color: "#FFFFFF", email_domains: ["utoronto.ca"], language: "en",
  faculties: ["Arts", "Science", "Management"],
}, {
  slug: "uqam", timezone: "America/Toronto", name: "Université du Québec à Montréal", primary_color: "#0072BC",
  secondary_color: "#FFFFFF", email_domains: ["uqam.ca"], language: "fr",
  faculties: ["Arts", "Sciences"],
}, {
  slug: "ulaval", timezone: "America/Toronto", name: "Université Laval", primary_color: "#E30513",
  secondary_color: "#FFC72C", email_domains: ["ulaval.ca"], language: "fr", faculties: [],
}];

const MOCK_CLUBS = [
  {
    id: 1,
    club_name: "UW Tech Club",
    status: "approved",
    club_type: "independent",
    club_page: "https://example.com/tech",
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
    description: "Board games club",
    school: "uwaterloo",
    categories: ["Social"],
    event_count: 1,
  },
  {
    id: 3,
    club_name: "UW Computer Science Club",
    club_type: "independent",
    club_page: "https://csclub.uwaterloo.ca",
    description: "Computer science club",
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

test.beforeEach(async ({ page, next }) => {
  await page.route("https://www.google.com/maps/embed/**", route => route.fulfill({ contentType: "text/html", body: "<html><body>Map fixture</body></html>" }));
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes("localhost:8000") && status >= 400) {
      console.log(`[API RESPONSE ERROR] ${response.request().method()} ${url} -> ${status}`);
    }
  });

  await mockApi(page, next, url => apiPath(url) === "/meta/constants", async () => {
    return ({
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
  });

  await mockApi(page, next, url => apiPath(url) === "/schools" || MOCK_SCHOOLS.some(school => apiPath(url) === `/schools/${school.slug}`), async (request) => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiPath(new URL(request.url)) === "/schools" ? MOCK_SCHOOLS : MOCK_SCHOOLS.find(school => apiPath(new URL(request.url)) === `/schools/${school.slug}`)),
    });
  });

  await mockApi(page, next, url => apiPath(url) === "/going-events", async () => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await mockApi(page, next, url => apiPath(url) === "/events/stats", async () => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await mockApi(page, next, url => apiPath(url) === "/saved-clubs", async () => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await mockApi(page, next, url => ["/events", "/events/admin"].includes(apiPath(url) ?? ""), async () => {

    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    return ({
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
            club_id: 1,
            club: "UW Tech Club",
            club_type: "wusa",
            club_page: "https://example.com/tech",
            club_ig: "uwtechclub",
            club_discord: "https://discord.gg/uwtechclub",
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

  await mockApi(page, next, url => apiPath(url) === "/clubs", async (request) => {
    const requestUrl = new URL(request.url);
    const search = requestUrl.searchParams.get("search")?.toLowerCase() ?? "";
    const ids = requestUrl.searchParams.getAll("ids").map(Number);
    const minEvents = Number(requestUrl.searchParams.get("min_events") ?? 0);
    let items = MOCK_CLUBS;
    items = items.filter(club => club.event_count >= minEvents);

    if (search) {
      items = items.filter((club) =>
        club.club_name.toLowerCase().includes(search)
      );
    }
    if (ids.length > 0) {
      items = items.filter((club) => ids.includes(club.id));
    }

    return ({
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

test.describe("School timezone rendering", () => {
  test.use({ timezoneId: "Asia/Tokyo" });

  test("an overseas browser shows the event school's clock in cards and details", async ({ page, next }) => {
    const event = {
      id: 501, title: "School timezone regression", school: "uwaterloo", club_id: 1,
      club: "UW Tech Club", location: "SLC", category: "Career", price: 0,
      food: [], registration: false, cancelled: false, source_image_url: null,
      added_at: new Date().toISOString(),
      occurrences: [{ id: "timezone-session", event_id: 501, dtstart_utc: "2035-01-15T04:30:00Z", dtend_utc: "2035-01-15T05:30:00Z" }],
    };
    await mockApi(page, next, url => apiPath(url) === "/events", async () => ({ json: {
      items: [event], total: 1, page: 1, page_size: 20, total_pages: 1,
    } }));
    await mockApi(page, next, url => apiPath(url) === "/events/501", async () => ({ json: event }));
    await page.goto(BASE);
    await expect(page.getByText(/11:30.*PM.*EST/).first()).toBeVisible();
    await page.goto(`${BASE}/events/501`);
    await expect(page.getByText(/11:30.*PM.*EST/).first()).toBeVisible();
  });
});

test.describe("Language loading", () => {
  test("defaults a French school to French and preserves an explicit English preference", async ({ page }) => {
    await page.goto("http://uqam.wat2do.localhost:3000/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await page.getByRole("combobox").filter({ hasText: "Français" }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

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
      page.getByRole("link", {
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

async function seedAuthenticatedSession(page: Page, next: NextFixture) {
  // Mock auth refresh
  await mockApi(page, next, url => apiPath(url) === "/auth/refresh", async () => {
    return ({
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
  await mockApi(page, next, url => apiPath(url) === "/users/me", async () => {
    return ({
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

  // Mock clubs/mine
  await mockApi(page, next, url => apiPath(url) === "/clubs/mine", async () => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_CLUBS[0]]),
    });
  });

  // Mock integrations endpoints
  const platforms = ["whatsapp", "discord", "slack", "telegram", "linkedin", "facebook", "instagram"];
  for (const p of platforms) {
    await mockApi(page, next, url => apiPath(url)?.match(new RegExp(`^/clubs/\\d+/integrations/${p}$`)) != null, async (request) => {
      const method = request.method;
      if (method === "GET") {
        return ({
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
        const body = (await request.json()) || {};
        return ({
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
        return ({
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
      throw new Error(`Unexpected integration method: ${method}`);
    });

    await mockApi(page, next, url => apiPath(url) === `/clubs/integrations/${p}/options`, async () => {
      return ({
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
  await mockApi(page, next, url => apiPath(url) === "/saved-clubs", async () => {
    return ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Mock saved events
  await mockApi(page, next, url => apiPath(url) === "/going-events", async () => {
    return ({
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
  page: Page,
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
  test("restores a shared session without a campus-local profile cache", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await page.goto(BASE);
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();

    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
    await expect.poll(() => page.evaluate(
      (key) => window.localStorage.getItem(key), STORAGE_KEYS.USER_EMAIL,
    )).toBe(JSON.stringify(TEST_EMAIL));
  });

  test("keeps the cached session when a deploy interrupts a 401 retry", async ({
    page, next,
  }) => {
    let refreshRequestCount = 0;
    await mockApi(page, next, url => apiPath(url) === "/auth/refresh", async () => {
      refreshRequestCount += 1;
      if (refreshRequestCount === 1) {
        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "expired-access-token",
            token_type: "bearer",
            expires_in: 1,
            user_id: "mock-user-id",
          }),
        });
      }

      return ({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Service restarting" }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/users/me", async () => {
      return ({
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
        const candidate = Array.from(document.querySelectorAll("h1")).find(element => element.getClientRects().length > 0);
        if (!heading && candidate?.getClientRects().length) heading = candidate;
        if (heading && !heading.isConnected) {
          removed = true;
        }
      };
      const observer = new MutationObserver(readHeading);
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style"] });
      Object.defineProperty(window, "__readHydrationHeadingProbe", {
        configurable: true,
        value: () => ({ captured: heading !== null, removed }),
      });
    });

    await page.goto(`${BASE}/login`);
    await expect(page.locator("h1")).toContainText("Discover");
    await page.getByRole("textbox", { name: "Email address" }).fill(TEST_EMAIL);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();

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
    await expect(page.getByRole("button", { name: "Continue without signing in" })).toBeVisible();
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

  test("continues from email to verification code entry", async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/auth/send-otp", async () => {
      return ({
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

  test("six OTP digits automatically submit once without a button click", async ({ page, next }) => {
    let attempts = 0;
    await mockApi(page, next, url => apiPath(url) === "/auth/send-otp", () => ({ json: { message: "sent" } }));
    await mockApi(page, next, url => apiPath(url) === "/auth/verify-otp", async () => {
      attempts += 1;
      return ({ status: 401, json: { detail: "Invalid code" } });
    });
    await page.goto(`${BASE}/login`);
    await page.getByRole("textbox", { name: "Email address" }).fill(TEST_EMAIL);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const code = page.getByRole("textbox", { name: "Verification code", exact: true });
    await code.fill("12345");
    expect(attempts).toBe(0);
    await code.fill("123456");
    await expect(page.getByText("This login code is invalid or has expired.")).toBeVisible();
    expect(attempts).toBe(1);
    await code.fill("123457");
    await expect.poll(() => attempts).toBe(2);
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

  test("shows error on invalid signup attempt", async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/auth/send-otp", async () => {
      return ({
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

    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Use a supported school email");
  });
});

// ── Workflow 7: Posters & QR Analytics ─────────────────────────────────

test.describe("Posters & QR Analytics", () => {
  test("marketing, admin posters, and club posters share QR data", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await seedQrData(page, { withScans: true });

    // Marketing page: shows QR cards
    await page.goto(`${BASE}/marketing`);
    await expect(page.getByRole("heading", { name: "Marketing" })).toBeVisible();
    await expect(page.getByText("Test Poster 1")).toBeVisible();

    // Admin posters page: shows same QR code data
    await page.goto(`${BASE}/admin/posters`);
    await expect(page.getByText("Test Poster 1").first()).toBeVisible();

    // Club panel posters page reuses same posters view
    await page.goto(`${BASE}/club-panel/posters`);
    await expect(page.getByText("Test Poster 1").first()).toBeVisible();
  });
});

test.describe("Admin diagnostics", () => {
  test("admin event search fetches one page and reports open unloaded events", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    const requests: URLSearchParams[] = [];
    const now = new Date().toISOString();
    const event = {
      id: 99, title: "Reported event outside this page", club: "UW Tech Club", club_id: 1,
      location: "SLC", school: "uwaterloo", category: "Career", added_at: now,
      occurrences: [], food: [], price: 0, registration: false,
    };
    await mockApi(page, next, url => apiPath(url) === "/events/admin", async request => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      expect(params.get("page_size")).toBe("20");
      const currentPage = Number(params.get("page"));
      return { json: {
        items: [{ ...event, id: currentPage, title: `Admin page ${currentPage}` }],
        total: 51, page: currentPage, page_size: 20, total_pages: 3,
      } };
    });
    await mockApi(page, next, url => apiPath(url) === "/events/99", async () => ({ json: event }));
    await mockApi(page, next, url => apiPath(url) === "/reports", async () => ({ json: {
      items: [{ id: "report-99", event_id: 99, event_title: event.title, reason: "Wrong location", school: event.school, status: "pending", reported_at: now }],
      total: 1, page: 1, page_size: 20, total_pages: 1,
    } }));
    await mockApi(page, next, url => apiPath(url) === "/submissions", async () => ({ json: {
      items: [], total: 0, page: 1, page_size: 1, total_pages: 0,
    } }));

    await page.goto(`${BASE}/admin/events`);
    await expect(page.getByRole("cell", { name: "Admin page 1", exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Admin page 2", exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    const search = page.getByPlaceholder("Search events...");
    await search.fill("Dance");
    expect(requests).toHaveLength(2);
    await search.press("Enter");
    await expect(page.getByRole("cell", { name: "Admin page 1", exact: true })).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[2].get("search")).toBe("Dance");
    expect(requests[2].get("page")).toBe("1");

    await page.getByRole("tab", { name: "Event reports 1", exact: true }).click();
    await page.getByRole("row").filter({ hasText: "Wrong location" }).getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("dialog", { name: event.title, exact: true })).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  test("admin cards count all pending queues and replace recent activity", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    let releaseSubmissions = () => {};
    const submissionsReady = new Promise<void>(resolve => { releaseSubmissions = resolve; });
    const now = new Date().toISOString();
    await mockApi(page, next, url => apiPath(url) === "/submissions", async request => {
      await submissionsReady;
      const params = new URL(request.url).searchParams;
      expect(params.has("school")).toBe(false);
      expect(params.get("submission_status")).toBe("pending");
      expect(params.get("page_size")).toBe("1");
      const currentPage = Number(params.get("page") ?? 1);
      const statuses = ["pending"];
      return { json: {
        items: statuses.map((status, index) => ({ id: `submission-${currentPage}-${index}`, event_data: { title: "Demo", occurrences: [] }, status, submitted_at: now })),
        total: 2, page: currentPage, page_size: 1, total_pages: 2,
      } };
    });
    await mockApi(page, next, url => apiPath(url) === "/reports", async () => ({
      json: { items: ["pending", "pending"].map((status, index) => ({
        id: `report-${index}`, event_id: 1, event_title: "Tech Career Fair", reason: `Reason ${index}`, status, reported_at: now,
      })), total: 2, page: 1, page_size: 20, total_pages: 1 },
    }));
    await mockApi(page, next, url => apiPath(url) === "/clubs/claims", async () => ({
      json: { items: [{ id: "pending-claim", status: "pending" }], total: 1, page: 1, page_size: 1, total_pages: 1 },
    }));
    await mockApi(page, next, url => apiPath(url) === "/clubs/review", async () => ({
      json: { items: [
        { ...MOCK_CLUBS[0], status: "pending" },
        { ...MOCK_CLUBS[1], status: "pending", school: "ulaval" },
      ], total: 2, page: 1, page_size: 20, total_pages: 1 },
    }));
    await mockApi(page, next, url => apiPath(url) === "/position-submissions", async request => {
      expect(new URL(request.url).searchParams.get("submission_status")).toBe("pending");
      return { json: { items: [{ id: "pending-position", status: "pending" }], total: 43, page: 1, page_size: 20, total_pages: 3 } };
    });
    await mockApi(page, next, url => apiPath(url) === "/payouts/admin", async request => {
      expect(new URL(request.url).searchParams.get("payout_status")).toBe("pending");
      return { json: { items: [{ id: "pending-payout", status: "pending" }], total: 27, page: 1, page_size: 1, total_pages: 27 } };
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/admin`);
    try {
      await expect(page.getByRole("status", { name: "Event Submissions: Loading...", exact: true })).toBeVisible();
      await expect(page.locator('[data-slot="admin-card-counts"]').getByText(/Unknown/)).toHaveCount(0);
    } finally {
      releaseSubmissions();
    }
    const events = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Events", exact: true }) });
    const clubs = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Clubs", exact: true }) });
    const positions = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Positions", exact: true }) });
    const posters = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Posters", exact: true }) });
    await expect(events.getByText("Event Submissions: 2 pending", { exact: true })).toBeVisible();
    await expect(events.getByRole("status", { name: "Event Submissions: Loading...", exact: true })).toHaveCount(0);
    await expect(events.getByText("Event reports: 2 pending", { exact: true })).toBeVisible();
    await expect(clubs.getByText("Club submissions: 2 pending", { exact: true })).toBeVisible();
    await expect(clubs.getByText("Claim Requests: 1 pending", { exact: true })).toBeVisible();
    await expect(positions.getByText("Position submissions: 43 pending", { exact: true })).toBeVisible();
    await expect(posters.getByText("Payouts: 27 pending", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Activity", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    const headingBox = await events.getByRole("heading").boundingBox();
    const countBox = await events.locator('[data-slot="admin-card-counts"]').boundingBox();
    expect(headingBox && countBox && countBox.y >= headingBox.y + headingBox.height).toBeTruthy();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(events.locator('[data-slot="admin-card-counts"]')).toHaveCSS("flex-direction", "column");
      await expect.poll(async () => {
        const submissions = await events.getByText("Event Submissions: 2 pending", { exact: true }).boundingBox();
        const reports = await events.getByText("Event reports: 2 pending", { exact: true }).boundingBox();
        return Boolean(submissions && reports && reports.y >= submissions.y + submissions.height
          && Math.abs(reports.x - submissions.x) < 2);
      }).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await events.click();
    await expect(page).toHaveURL(`${BASE}/admin/events`);
    await page.getByRole("tab", { name: "Event reports 2", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Reason 0", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Reason 1", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Reason 2", exact: true })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Reason 3", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "2 Event reports", exact: true })).toBeVisible();
    await page.getByRole("row").filter({ hasText: "Reason 0" }).getByRole("button", { name: "View", exact: true }).click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    await expect(page).toHaveURL(`${BASE}/admin/events`);
  });

  test("opens from the admin dashboard and shows Automate logs under scraping", async ({
    page, next,
  }) => {
    await seedAuthenticatedSession(page, next);
    await mockApi(page, next, url => apiPath(url) === "/webhooks/automate/logs", async () => ({ json: [] }));
    await seedQrData(page);
    await mockApi(page, next, url => apiPath(url) === "/submissions", async () => {
      return ({
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
  for (const school of ["uwaterloo", "western"]) {
  test(`adds an existing event by ID and prepopulates its club for ${school}`, async ({
    page, next,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAuthenticatedSession(page, next);

    const clubName = school === "western" ? "Western Tech Club" : "UW Tech Club";
    await mockApi(page, next, url => apiPath(url) === "/clubs", async request => {
      const requestedSchool = new URL(request.url).searchParams.get("school");
      const items = requestedSchool === school ? [{ ...MOCK_CLUBS[0], school, club_name: clubName, ig: `${school}techclub` }] : [];
      return { json: { items, total: items.length, page: 1, page_size: 20, total_pages: 1 } };
    });

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
      club: clubName,
      club_type: "independent",
      club_page: "https://example.com/tech",
      club_ig: "uwtechclub",
      club_discord: null,
      ig_handle: "uwtechclub",
      school,
      cancelled: false,
      added_at: new Date().toISOString(),
    });
    const firstEvent = eventSummary(1, "First Carousel Event");
    const secondEvent = eventSummary(2, "Second Carousel Event");
    const batchItem = (event: ReturnType<typeof eventSummary>, position: number) => ({
      id: `00000000-0000-4000-9000-${String(event.id).padStart(12, "0")}`,
      batch_id: "00000000-0000-4000-8000-000000000001",
      account_key: school,
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
      account_key: school,
      instagram_user_id: "17841476154506771",
      school,
      local_date: "2026-08-03",
      window_start: "2026-08-02T12:00:00Z",
      window_end: "2026-08-03T12:00:00Z",
      status: "ready_for_review",
      caption: "Campus events",
      caption_intro: "" as string,
      cover_body: "Our latest picks",
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
    let patchCount = 0;
    let eventUpdateCount = 0;
    const editedClubIds: number[] = [];
    let currentBatch = initialBatch;
    let publishedBatch: Record<string, unknown> | null = null;
    let publishedVersion: number | null = null;

    await mockApi(page, next, url => apiPath(url) === "/instagram-publishing/batches", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ ...batchBase, version: 1, item_count: 1, eligible_count: 1 }],
          total: 1,
          page: 1,
          page_size: 25,
          total_pages: 1,
        }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === `/instagram-publishing/batches/${batchBase.id}`, async (request) => {
        if (request.method === "PATCH") {
          const requestBody = (await request.json()) as { event_ids: number[]; caption_intro: string };
          patchCount += 1;
          savedEventIds = requestBody.event_ids;
          currentBatch = {
            ...savedBatch,
            caption_intro: requestBody.caption_intro,
            version: currentBatch.version + 1,
            items: requestBody.event_ids.map((id, index) => batchItem(id === 1 ? firstEvent : secondEvent, index + 1)),
          };
          return ({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentBatch),
          });
        }

        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(publishedBatch ?? currentBatch),
        });
      });
    await mockApi(page, next, url => apiPath(url) === `/instagram-publishing/batches/${batchBase.id}/publish`, async request => {
      const body = await request.json() as { version: number };
      publishedVersion = body.version;
      expect(patchCount).toBe(2);
      expect(body.version).toBe(currentBatch.version);
      publishedBatch = {
        ...currentBatch,
        status: "published",
        published_cover_url: "https://example.com/published-cover.png",
        items: currentBatch.items.map((item, index) => ({
          ...item,
          event_id: index === 0 ? null : item.event_id,
          event: index === 0 ? null : item.event,
          published_asset_url: `https://example.com/published-${index}.png`,
        })),
      };
      return { json: publishedBatch };
    });
    await mockApi(page, next, url => ["/events/1", "/events/2"].some(path => path === apiPath(url)), async (request) => {
      if (request.method !== "GET") {
        eventUpdateCount += 1;
        const body = await request.json() as { club_id: number; title?: string };
        const editedEvent = apiPath(new URL(request.url)) === "/events/1" ? firstEvent : secondEvent;
        if (body.title) editedEvent.title = body.title;
        editedClubIds.push(body.club_id);
      }
      const event = apiPath(new URL(request.url)) === "/events/1" ? firstEvent : secondEvent;
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...event, club_id: 1 }),
      });
    });

    await page.goto(`${BASE}/admin/instagram`);
    await page.getByRole("button", { name: school }).click();

    const drawer = page.getByRole("dialog", { name: school });
    const split = drawer.locator('[data-columns="split"]');
    expect(await split.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
    for (const column of await split.locator(":scope > div").all()) {
      await expect(column).toHaveCSS("overflow-y", "auto");
    }
    await drawer.getByLabel("Your caption intro", { exact: true }).fill("Your weekend plans");
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

    expect(savedEventIds).toBeNull();
    await expect(drawer.locator("figure")).toHaveCount(3);
    await expect(drawer.getByText("Second Carousel Event").first()).toBeVisible();
    expect(currentBatch.caption_intro).toBe("");
    await expect(drawer.getByLabel("Saved caption preview (event details appended automatically)", { exact: true })).toHaveCount(0);

    const firstPreview = drawer.locator("figure").filter({ hasText: "First Carousel Event" });
    await firstPreview.click();
    await expect(firstPreview).toHaveAttribute("aria-pressed", "true");
    await expect(drawer.getByRole("textbox", { name: "Club *", exact: true })).toHaveValue(clubName);
    expect(patchCount).toBe(0);
    expect(eventUpdateCount).toBe(0);

    const firstPosition = drawer.getByRole("textbox", { name: "Slide 1 of 2", exact: true });
    await firstPosition.fill("2");
    await firstPosition.press("Enter");
    expect(savedEventIds).toBeNull();

    await drawer.getByRole("textbox", { name: "Club *", exact: true })
      .fill(school === "western" ? "@westerntechclub" : "  uw tech club  ");
    await drawer.getByRole("textbox", { name: /Event Title/ }).fill("Edited before adding another event");
    await drawer.getByRole("button", { name: "Add event ID" }).click();
    await expect(eventIdInput).toBeVisible();
    expect(eventUpdateCount).toBe(0);
    expect(patchCount).toBe(0);
    await addEventForm.getByRole("button", { name: "Cancel", exact: true }).click();
    const secondPreview = drawer.locator("figure").filter({ hasText: "Second Carousel Event" });
    await secondPreview.click();
    await expect(drawer.getByRole("textbox", { name: /Event Title/ })).toHaveValue("Second Carousel Event");
    await drawer.locator("figure").filter({ hasText: "Edited before adding another event" }).click();
    await expect(drawer.getByRole("textbox", { name: /Event Title/ })).toHaveValue("Edited before adding another event");
    expect(eventUpdateCount).toBe(0);
    await drawer.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => eventUpdateCount).toBe(1);
    await expect.poll(() => savedEventIds).toEqual([2, 1]);
    expect(patchCount).toBe(1);
    expect(currentBatch.caption_intro).toBe("Your weekend plans");
    expect(editedClubIds).toEqual([1]);
    await drawer.getByRole("button", { name: "Publish to Instagram", exact: true }).click();
    await expect.poll(() => publishedVersion !== null && publishedVersion === currentBatch.version).toBe(true);
    await expect(drawer.locator("figure")).toHaveCount(3);
    await expect(drawer.locator('img[src="https://example.com/published-0.png"]')).toBeVisible();
  });
  }
});

// ── Workflow 8: Club Integrations ─────────────────────────────

test.describe("Club Integrations", () => {
  test("can connect WhatsApp integration end to end", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await page.goto(`${BASE}/club-panel/integrations`);

    // WhatsApp card
    const whatsappCard = page
      .locator("div.bg-surface", { hasText: "WhatsApp" })
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

  test("can connect Discord integration with channel selection", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await page.goto(`${BASE}/club-panel/integrations`);

    const discordCard = page
      .locator("div.bg-surface", { hasText: "Discord" })
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
  test("keeps mobile event controls fixed, preserves latest time, and navigates attendee drawers", async ({ page, next }, testInfo) => {
    const title = "A very long campus event title that must truncate before the added time on a small mobile screen";
    const addedAt = new Date(Date.now() - 3_600_000).toISOString();
    const events = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1, title: index === 0 ? title : `Campus event ${index + 1}`,
      description: "Event details. ".repeat(150), location: "SLC", price: 0,
      food: [], registration: false, source_image_url: null, source_url: null,
      category: "Career", club_id: 1, club: "UW Tech Club",
      club_type: "independent", school: "uwaterloo", added_at: addedAt,
      occurrences: [{ id: String(index + 1), event_id: index + 1,
        dtstart_utc: new Date(Date.now() + (index + 1) * 86_400_000).toISOString(), dtend_utc: null }],
    }));
    const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="blue"/></svg>');
    await mockApi(page, next, url => apiPath(url) === "/events", async () => ({ json: {
      items: events, total: events.length, page: 1, page_size: 100, total_pages: 1,
      latest_added_event: { title, added_at: addedAt },
    } }));
    await mockApi(page, next, url => /^\/events\/\d+$/.test(apiPath(url) ?? ""), async request => ({ json: events[Number(new URL(request.url).pathname.split("/").at(-1)) - 1] }));
    await mockApi(page, next, url => /^\/going-events\/\d+\/attendees$/.test(apiPath(url) ?? ""), async () => ({ json: {
      going_count: 1, attendees: [{ name: "Taylor Q.", avatar_url: avatar }],
    } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    const header = page.locator('[data-slot="page-header"]:visible');
    const latest = header.getByRole("button").filter({ hasText: title });
    await expect(latest).toBeVisible();
    await expect(latest.getByText(/added .*ago/)).toBeVisible();
    await expect.poll(() => latest.getByText(title, { exact: true }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    const scrollRoot = page.locator(".main-content-grid:visible");
    await expect(scrollRoot).toHaveCSS("padding-top", "0px");
    await expect(header).toHaveCSS("margin-top", "0px");
    await expect(header).toHaveCSS("padding-top", "16px");
    expect(Math.abs((await header.boundingBox())!.y - (await scrollRoot.boundingBox())!.y)).toBeLessThan(2);
    await scrollRoot.evaluate(element => { element.scrollTop = 400; });
    await expect.poll(() => scrollRoot.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
    const pinnedTop = (await header.boundingBox())!.y;
    await scrollRoot.evaluate(element => { element.scrollTop = 700; });
    await expect.poll(async () => Math.abs((await header.boundingBox())!.y - pinnedTop)).toBeLessThan(1);
    await scrollRoot.evaluate(element => { element.scrollTop = 0; });
    await page.locator('article[data-event-id="1"]:visible').getByText("SLC", { exact: true }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("img", { name: "Taylor Q." })).toBeVisible();
    const photo = drawer.locator(`img[src="${avatar}"]`);
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(32);
    await drawer.getByRole("button", { name: "Next", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(drawer.getByRole("heading", { name: "Campus event 2", level: 2, exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(drawer.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("event-drawer-mobile.png"), fullPage: true });
    await page.goto(`${BASE}/events/1`);
    await expect(page.getByRole("img", { name: "Taylor Q." })).toBeVisible();
    await page.locator('[data-slot="event-actions"]').getByRole("button", { name: "Save to calendar", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Google Calendar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "iCal" })).toBeVisible();
  });

  test("returns one upcoming event for the random search command", async ({
    page,
  }) => {
    await page.goto(BASE);

    const cards = page.locator("article[data-event-id]:visible");
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

    await expect(page.locator(".main-content-grid:visible")).toHaveCSS("overflow-y", "auto");
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

  test("renders the club type icon from the event feed signature", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const assetResponse = page.waitForResponse(
      response =>
        response.url().endsWith("/icons/club-types/utsc-scsu.svg") &&
        response.status() === 200,
    );
    await page.goto("http://utsc.wat2do.localhost:3000/school/utsc");

    await expect(
      page.getByRole("heading", { name: "UTSC Eats SCSU Logo Preview" }),
    ).toBeVisible();

    const icon = page.getByRole("img", {
      name: "Club type: SCSU",
    }).first();
    await expect(icon).toBeVisible();
    await expect
      .poll(() => icon.evaluate(element => getComputedStyle(element).maskImage))
      .toContain("/icons/club-types/utsc-scsu.svg");

    const eventGrid = page.locator('[role="list"] section > div.grid').first();
    await expect
      .poll(() =>
        eventGrid.evaluate(
          element => getComputedStyle(element).gridTemplateColumns.split(" ").length,
        ),
      )
      .toBe(6);

    const clubName = page
      .getByText("UTSC Eats Campus Group", { exact: true })
      .first();
    await expect
      .poll(() =>
        clubName.evaluate(element => ({
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
    const eventCount = page.getByRole("heading", { name: "1 upcoming event", exact: true });
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
          stripBox,
        ] = await Promise.all([
          eventSearch.boundingBox(),
          addEventButton.boundingBox(),
          moreFiltersButton.boundingBox(),
          page.getByTestId("event-quick-filter-scroll").boundingBox(),
        ]);
        return {
          searchHeight: searchBox?.height,
          addEventHeight: addEventBox?.height,
          moreFiltersHeight: moreFiltersBox?.height,
          sharesSearchRow: Boolean(searchBox && addEventBox &&
            Math.abs(searchBox.y - addEventBox.y) < 1 &&
            addEventBox.x >= searchBox.x + searchBox.width),
          filtersBesideStrip: Boolean(stripBox && moreFiltersBox &&
            Math.abs(stripBox.y - moreFiltersBox.y) < 1 &&
            moreFiltersBox.x >= stripBox.x + stripBox.width),
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
      .poll(async () => {
        const [countBox, searchBox] = await Promise.all([
          eventCount.boundingBox(), eventSearch.boundingBox(),
        ]);
        return Boolean(countBox && searchBox && countBox.y + countBox.height < searchBox.y);
      })
      .toBe(true);

    await page.screenshot({ path: "e2e/screenshots/events-page.png", fullPage: true });
  });

  test("permanently filters events after their effective end", async ({ page, next }) => {
    const nowMs = Date.now();
    const eventBase = {
      location: "SLC",
      price: 0,
      food: [],
      registration: false,
      source_image_url: null,
      category: "Career",
      club: "UW Tech Club",
      club_type: "wusa",
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

    await mockApi(page, next, url => apiPath(url) === "/events", async () => {
      return ({
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

    await expect(page.locator('article[data-event-id="1"]:visible')).toBeVisible();
    await expect(page.locator('article[data-event-id="2"]:visible')).toBeVisible();
    await expect(page.locator('article[data-event-id="5"]:visible')).toBeVisible();
    await expect(page.locator('article[data-event-id="3"]:visible')).toHaveCount(0);
    await expect(page.locator('article[data-event-id="4"]:visible')).toHaveCount(0);
  });

  test("shares and reports from event details while logged out", async ({ page, next }) => {
    let submittedReport: Record<string, unknown> | null = null;
    await mockApi(page, next, url => apiPath(url) === "/reports", async (request) => {
      submittedReport = (await request.json());
      return ({
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

    const card = page.locator('article[data-event-id="1"]:visible').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("dialog", { name: "Tech Career Fair" })).toBeVisible();
    await expect(page).toHaveURL(`${BASE}/`);

    const eventDrawer = page.getByRole("dialog", { name: "Tech Career Fair" });
    const hostSection = eventDrawer.locator('[data-slot="event-host"]');
    await eventDrawer.locator('[data-slot="event-actions"]').getByRole("button", { name: "Save to calendar", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Google Calendar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "iCal" })).toBeVisible();
    await page.keyboard.press("Escape");
    const hostLinks = hostSection.locator(':scope > [data-slot="event-host-links"]');
    await expect(hostSection.getByText("UW Tech Club")).toBeVisible();
    await expect(hostLinks).toHaveCount(0);
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
      page.getByRole("dialog").getByRole("heading", { name: "Report submitted" }),
    ).toBeVisible();
    expect(submittedReport).toEqual({
      event_id: 1,
      reason: "Incorrect event details",
    });
  });

  test("opens the event poster in-app and closes the drawer after filtering by host", async ({
    page, next,
  }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    const posterUrl = "https://wat2do.io/media/e2e-event-poster.png";
    const posterBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const event = {
      id: 1,
      club_id: 1,
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
      club: "UW Tech Club",
      club_type: "wusa",
      club_page: "https://example.com/tech",
      club_ig: "uwtechclub",
      club_discord: "https://discord.gg/uwtechclub",
      school: "uwaterloo",
      cancelled: false,
      added_at: now.toISOString(),
    };

    await page.route(posterUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: posterBytes,
      });
    });

    await mockApi(page, next, url => apiPath(url) === "/events", async () => {
      return ({
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
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(event),
      });
    });

    await page.goto(BASE);
    const eventCard = page.locator('article[data-event-id="1"]:visible');
    await expect(eventCard.locator("foreignObject")).toHaveCount(0);
    await expect(eventCard.locator("svg > g > image")).toHaveAttribute(
      "href",
      posterUrl,
    );
    await eventCard.click();

    const eventDrawer = page.getByRole("dialog", { name: "Poster Dialog Event" });
    await expect(eventDrawer.locator("svg > g > image").first()).toHaveAttribute(
      "href",
      posterUrl,
    );
    await eventDrawer.getByRole("button", { name: "View full event image" }).click();

    const imageDialog = page.getByRole("dialog", { name: "View full event image" });
    await expect(imageDialog.getByRole("img", { name: "Poster Dialog Event" })).toBeVisible();
    await imageDialog.getByRole("button", { name: "Close" }).click();

    await eventDrawer.getByRole("button", { name: "UW Tech Club" }).last().click();
    await page
      .getByRole("menuitem", { name: "See more events by UW Tech Club" })
      .click();

    await expect(eventDrawer).not.toBeVisible();
    await expect(page).toHaveURL(BASE + "/");
    await expect(page.locator('article[data-event-id="1"]:visible')).toBeVisible();
  });

  test("lets admins delete events from the drawer and dedicated page", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    let deleteRequests = 0;

    await mockApi(page, next, url => apiPath(url) === "/events/1", async (request) => {
      if (request.method === "DELETE") {
        deleteRequests += 1;
        return ({ status: 204, body: "" });
      }

      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          club_id: 1,
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
          club: "UW Tech Club",
          club_type: "wusa",
          school: "uwaterloo",
          cancelled: false,
          added_at: new Date().toISOString(),
        }),
      });
    });

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]:visible').click();

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

  test("scrolls drawer content that exceeds the mobile viewport", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await page.setViewportSize({ width: 375, height: 320 });
    await page.goto(BASE);

    const card = page.locator('article[data-event-id="1"]:visible').first();
    await card.getByText("SLC", { exact: true }).click();
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
    await page.locator('article[data-event-id="1"]:visible').getByText("SLC", { exact: true }).click();

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

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("shows similar events below a dedicated event page", async ({ page, next }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    const eventDetails = [
      {
        id: 1,
        club_id: 1,
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
        club_type: "independent",
        school: "uwaterloo",
        source_url: null,
        category: "Career",
        club: "UW Tech Club",
        ig_handle: null,
        cancelled: false,
        added_at: now.toISOString(),
      },
      {
        id: 2,
        club_id: 2,
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
        club_type: "independent",
        school: "uwaterloo",
        source_url: null,
        category: "Social",
        club: "UW Board Games Club",
        ig_handle: null,
        cancelled: false,
        added_at: now.toISOString(),
      },
    ];

    await mockApi(page, next, (url) => ["/events/1", "/events/2"].includes(apiPath(url) ?? ""), async (request) => {
        const id = Number(apiPath(new URL(request.url))?.split("/").pop());
        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(eventDetails.find((event) => event.id === id)),
        });
      });
    await mockApi(page, next, (url) => apiPath(url) === "/events", async () => {
        return ({
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
      });

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
    page, next,
  }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    let registrationBody: { occurrence_ids: string[] } | null = null;

    await mockApi(page, next, url => apiPath(url) === "/auth/send-otp", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "sent" }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/auth/verify-otp", async () => {
      return ({
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
    await mockApi(page, next, url => apiPath(url) === "/users/me", async () => {
      return ({
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
    await mockApi(page, next, url => apiPath(url) === "/clubs/mine", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/going-events/1", async (request) => {
      registrationBody = (await request.json()) as {
        occurrence_ids: string[];
      };
      return ({
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
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          club_id: 1,
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
          club_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: "Career",
          club: "UW Tech Club",
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
        authForm.getByRole("button", { name: "Going", exact: true }),
      ).toBeDisabled();
    };

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]:visible').click();
    await assertEventDetails();
    await assertInlineRegistration();

    await page.goto(`${BASE}/events/1`);
    await assertEventDetails();
    await assertInlineRegistration();

    const authForm = page.getByTestId("event-registration-auth");
    const registerButton = authForm.getByRole("button", {
      name: "Going",
      exact: true,
    });
    await authForm.getByLabel("Email address").fill(TEST_EMAIL);
    await expect(registerButton).toBeEnabled();
    await registerButton.click();

    await expect(authForm.getByLabel("Verification code")).toBeVisible();
    await expect(registerButton).toBeDisabled();
    await authForm.getByLabel("Verification code").fill("123456");

    await expect.poll(() => registrationBody).toEqual({
      occurrence_ids: ["occurrence-1"],
    });
    await expect(page.getByText("Youre going!")).toBeVisible();
  });

  test("shows New in the top-left without an event category badge", async ({ page, next }) => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 86_400_000).toISOString();
    await mockApi(page, next, url => apiPath(url) === "/meta/constants", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event_categories: ["Arts & Culture"],
          club_categories: ["Arts & Culture"],
          interests: ["Arts & Culture"],
          interest_to_categories: { "Arts & Culture": ["Arts & Culture"] },
          report_statuses: ["pending", "resolved", "dismissed"],
        }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          club_id: 1,
          title: "Tech Career Fair",
          description: "Full detail loaded",
          location: "SLC",
          occurrences: [{ id: 1, event_id: 1, dtstart_utc: startsAt, dtend_utc: null }],
          price: 0,
          food: [],
          registration: false,
          source_image_url: null,
          club_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: null,
          club: "UW Tech Club",
          ig_handle: null,
          cancelled: false,
          added_at: now.toISOString(),
        }),
      });
    });

    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]:visible').click();

    const drawer = page.getByRole("dialog", { name: "Tech Career Fair" });
    await expect(drawer.getByText("Full detail loaded", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Arts & Culture", { exact: true })).toHaveCount(0);
    const newBadge = drawer.getByText("NEW", { exact: true });
    await expect(newBadge).toBeVisible();
    await expect(
      newBadge.locator("xpath=ancestor::div[contains(@class, 'absolute')][1]"),
    ).toHaveClass(/top-0.*left-0/);
  });

  test("uses recurring-event controls above the event drawer", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);

    const firstOccurrenceId = "11111111-1111-4111-8111-111111111111";
    const secondOccurrenceId = "22222222-2222-4222-8222-222222222222";
    const firstStartsAt = "2030-08-10T18:00:00Z";
    const secondStartsAt = "2030-08-17T18:00:00Z";
    let submittedOccurrenceIds: string[] | null = null;

    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          club_id: 1,
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
          club_type: "independent",
          school: "uwaterloo",
          source_url: null,
          category: "Career",
          club: "UW Tech Club",
          ig_handle: null,
          cancelled: false,
          added_at: new Date().toISOString(),
        }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/going-events/1", async (request) => {
      const body = (await request.json()) as {
        occurrence_ids: string[];
      };
      submittedOccurrenceIds = body.occurrence_ids;
      return ({
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
    await page.locator('article[data-event-id="1"]:visible').click();

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
    await page.keyboard.press("Escape");
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

    await drawer.getByRole("button", { name: "Going", exact: true }).click();

    await expect(drawer.getByText("Which time are you going?", { exact: true })).toBeVisible();
    await expect(drawer.locator('input[type="checkbox"]')).toHaveCount(0);

    const secondLabel = new Intl.DateTimeFormat("en", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(secondStartsAt));

    await drawer.getByRole("button", { name: secondLabel, exact: true }).click();
    await drawer.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect.poll(() => submittedOccurrenceIds).toEqual([secondOccurrenceId]);
  });

  test("shows relative card dates, full weekdays, metadata icons, and badge icons", async ({ page, next }) => {
    const now = new Date();
    const todayStartsAt = new Date(now.getTime() - 60_000);
    const todayEndsAt = new Date(now.getTime() + 3_600_000);
    const tomorrowStartsAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      12,
    );
    const laterStartsAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 7,
      12,
    );
    const eventFixture = {
      location: "SLC",
      price: 0,
      food: [] as string[],
      registration: false,
      source_image_url: null,
      category: "Career",
      club_id: 1,
      club: "UW Tech Club",
      club_type: "wusa",
      club_page: "https://example.com/tech",
      club_ig: "uwtechclub",
      club_discord: "https://discord.gg/uwtechclub",
      school: "uwaterloo",
      added_at: now.toISOString(),
    };

    await mockApi(page, next, url => apiPath(url) === "/events", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              ...eventFixture,
              id: 1,
              title: "Today with badges",
              occurrences: [
                {
                  id: 1,
                  event_id: 1,
                  dtstart_utc: todayStartsAt.toISOString(),
                  dtend_utc: todayEndsAt.toISOString(),
                },
              ],
              price: 12,
              food: ["Pizza"],
              registration: true,
            },
            {
              ...eventFixture,
              id: 2,
              title: "Tomorrow event",
              occurrences: [
                {
                  id: 2,
                  event_id: 2,
                  dtstart_utc: tomorrowStartsAt.toISOString(),
                  dtend_utc: null,
                },
              ],
            },
            {
              ...eventFixture,
              id: 3,
              title: "Later event",
              occurrences: [
                {
                  id: 3,
                  event_id: 3,
                  dtstart_utc: laterStartsAt.toISOString(),
                  dtend_utc: null,
                },
              ],
            },
          ],
          total: 3,
          page: 1,
          page_size: 20,
          total_pages: 1,
          latest_added_event: null,
        }),
      });
    });

    await page.goto(BASE);
    await page.waitForTimeout(3000);

    const todayCard = page.locator('article[data-event-id="1"]:visible');
    const tomorrowCard = page.locator('article[data-event-id="2"]:visible');
    const laterCard = page.locator('article[data-event-id="3"]:visible');
    await expect(todayCard).toBeVisible();
    await expect(todayCard).not.toContainText(/\b0 clicks?\b/);
    await expect(todayCard).not.toContainText(/\b0 going\b/);
    await expect(todayCard.locator('[data-slot="event-card-date"]')).toHaveText("Today");
    await expect(tomorrowCard.locator('[data-slot="event-card-date"]')).toHaveText("Tomorrow");

    const laterDate = new Intl.DateTimeFormat("en", {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(laterStartsAt);
    expect(laterDate).toMatch(
      /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/,
    );
    await expect(laterCard.locator('[data-slot="event-card-date"]')).toHaveText(laterDate);

    await expect(todayCard.getByRole("heading", { name: "Today with badges" })).toHaveCSS(
      "font-size",
      "15px",
    );
    await expect(todayCard.locator('[data-slot="event-card-date"] svg')).toHaveCount(1);
    await expect(todayCard.locator('[data-slot="event-card-time"] svg')).toHaveCount(1);
    await expect(todayCard.locator('[data-slot="event-card-location"] svg')).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );

    await expect(
      todayCard.getByText("$12", { exact: true }).locator("..").locator("svg"),
    ).toHaveCount(0);
    for (const badgeText of ["Pizza", "Registration"]) {
      await expect(
        todayCard.getByText(badgeText, { exact: true }).locator("..").locator("svg"),
      ).toHaveCount(1);
    }
    await expect(todayCard.locator('[data-slot="event-card-metadata"]')).toHaveCSS(
      "column-gap",
      "4px",
    );
    await expect(todayCard.locator('[data-slot="event-card-badges"]')).toHaveCSS(
      "row-gap",
      "2px",
    );

    const cardContent = todayCard.locator('[data-slot="event-card-content"]');
    const contentStack = cardContent.locator(":scope > div");
    await expect(cardContent).toHaveCSS("padding-top", "10px");
    await expect(contentStack).toHaveCSS("row-gap", "8px");
    await expect(contentStack.locator(":scope > div").nth(1)).toHaveCSS(
      "margin-top",
      "0px",
    );
  });

  test("counts event views from cards, arrows, and direct visits", async ({ page, next }) => {
    const clicks: number[] = [];
    await mockApi(page, next, url => apiPath(url) === "/interactions/batch", async request => {
      const payload = await request.json() as {
        interactions: Array<{ event_id: number; interaction_type: string }>;
      };
      clicks.push(...payload.interactions.filter(item => item.interaction_type === "click").map(item => item.event_id));
      return { status: 202, json: { recorded: payload.interactions.length } };
    });
    await page.goto(BASE);
    const cards = page.locator("article[data-event-id]:visible");
    await expect(cards.first()).toBeVisible();
    const firstId = Number(await cards.first().getAttribute("data-event-id"));
    const secondId = Number(await cards.nth(1).getAttribute("data-event-id"));
    expect(clicks).toEqual([]);
    await cards.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => clicks).toEqual([firstId]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => clicks).toEqual([firstId, secondId]);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => clicks).toEqual([firstId, secondId, firstId]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`/events/${secondId}`);
    await expect.poll(() => clicks).toEqual([firstId, secondId, firstId, secondId]);
    await page.reload();
    await expect.poll(() => clicks).toEqual([firstId, secondId, firstId, secondId, secondId]);
  });

  test("persists optimistic click and going stats across refresh", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);

    let clickCount = 0;
    let goingCount = 0;
    let isGoing = false;
    let eventId: number | null = null;

    await mockApi(page, next, url => apiPath(url) === "/events/stats", async () => {
      const hasStats = clickCount > 0 || goingCount > 0;
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          hasStats && eventId !== null
            ? { [eventId]: { click_count: clickCount, going_count: goingCount } }
            : {},
        ),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/going-events", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(isGoing && eventId !== null ? [{ event_id: eventId, occurrence_ids: ["1"] }] : []),
      });
    });
    await mockApi(page, next, url => apiPath(url)?.startsWith("/going-events/") === true, async (request) => {
      isGoing = request.method === "PUT";
      goingCount = isGoing ? 1 : 0;
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: isGoing ? "going" : "not_going",
          event_id: eventId,
          occurrence_ids: isGoing ? ["1"] : [],
          going_count: goingCount,
        }),
      });
    });
    await mockApi(page, next, url => apiPath(url) === "/interactions/batch", async (request) => {
      const payload = (await request.json()) as {
        interactions?: Array<{ event_id: number; interaction_type: string }>;
      };
      clickCount +=
        payload.interactions?.filter(
          (interaction) =>
            interaction.event_id === eventId && interaction.interaction_type === "click",
        ).length ?? 0;
      return ({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ recorded: payload.interactions?.length ?? 0 }),
      });
    });

    await page.goto(BASE);
    const card = page.locator("article[data-event-id]:visible").first();
    await expect(card).toBeVisible();
    eventId = Number(await card.getAttribute("data-event-id"));
    expect(eventId).toBeGreaterThan(0);

    await card.click();
    await page.getByRole("dialog").getByRole("button", { name: "Going", exact: true }).click();
    await expect.poll(() => goingCount).toBe(1);
    await page.keyboard.press("Escape");
    await expect(card).toContainText("1 click · 1 going");

    await page.reload();
    const refreshedCard = page.locator(`article[data-event-id="${eventId}"]:visible`).first();
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

  test("uses a toggle for newly added events when signed out", async ({ page }) => {
    await page.goto(BASE);

    const newlyAddedSelect = page.getByRole("button", {
      name: "New", exact: true,
    });
    await expect(newlyAddedSelect).toHaveAttribute("aria-pressed", "false");
    const hasFoodFilter = page.getByRole("button", {
      name: "Food",
      exact: true,
    });
    const [selectStyles, buttonStyles] = await Promise.all(
      [newlyAddedSelect, hasFoodFilter].map((control) =>
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
    await expect(newlyAddedSelect).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("option", { name: "Added since last visit" }),
    ).toHaveCount(0);

    const newBadges = page.locator("article:visible").getByText("NEW", { exact: true });
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

    await newlyAddedSelect.click();
    await expect(newlyAddedSelect).toHaveAttribute("aria-pressed", "false");
  });

  test("opens minimum going on mouse down, filters with a number input, and resets with All", async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/events/stats", async () => {
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ "1": { going_count: 3, saved_count: 0, view_count: 0 } }),
      });
    });
    await page.goto(BASE);
    const card = page.getByRole("button", { name: "Event: Tech Career Fair", exact: true });
    const minimumGoing = page.getByRole("spinbutton", { name: "Minimum going" });
    await expect(card).toBeVisible();
    await expect(minimumGoing).toHaveCount(0);
    await page.getByRole("button", { name: ">0 going", exact: true }).hover();
    await expect(minimumGoing).toHaveCount(0);
    await page.mouse.down();
    await expect(minimumGoing).toBeVisible();
    await page.mouse.up();
    await expect(page.getByText("Minimum going", { exact: true })).toBeVisible();
    await expect(minimumGoing).toHaveValue("0");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: ">0 going", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(minimumGoing).toBeVisible();
    await minimumGoing.hover();
    await minimumGoing.fill("3");
    await expect(page.getByRole("button", { name: ">3 going", exact: true })).toBeVisible();
    await minimumGoing.press("Backspace");
    await expect(minimumGoing).toHaveValue("");
    await expect(page.getByRole("button", { name: ">0 going", exact: true })).toBeVisible();
    await minimumGoing.fill("03");
    await expect(minimumGoing).toHaveValue("3");
    await minimumGoing.fill("-1");
    await expect(page.getByRole("button", { name: ">3 going", exact: true })).toBeVisible();
    await expect(card).toBeVisible();
    await minimumGoing.fill("4");
    await expect(card).toHaveCount(0);
    await minimumGoing.fill("0");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: ">0 going", exact: true }).click();
    await expect(minimumGoing).toHaveValue("0");
    await expect(card).toBeVisible();
  });

  test("opens shared date options on mouse down rather than hover", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("combobox", { name: "Event date" }).hover();
    const tomorrow = page.getByRole("option", { name: "Tomorrow", exact: true });
    await expect(tomorrow).toHaveCount(0);
    await page.mouse.down();
    await expect(tomorrow).toBeVisible();
    await page.mouse.up();
    await expect(tomorrow).toBeVisible();
    await tomorrow.hover();
    await expect(tomorrow).toBeVisible();
    await tomorrow.click();
    await expect(page.getByRole("combobox", { name: "Event date" })).toContainText("Tomorrow");
  });

  test("filters events by preset or custom date from the quick-filter strip", async ({
    page,
  }) => {
    await page.goto(BASE);

    const dateFilter = page.getByRole("combobox", { name: "Event date" });
    await expect(dateFilter.locator("svg")).toHaveCount(0);
    const hasFoodFilter = page.getByRole("button", {
      name: "Food",
      exact: true,
    });
    const [hasFoodBounds, dateFilterBounds] = await Promise.all([
      hasFoodFilter.boundingBox(),
      dateFilter.boundingBox(),
    ]);
    expect(hasFoodBounds).not.toBeNull();
    expect(dateFilterBounds).not.toBeNull();
    if (hasFoodBounds && dateFilterBounds) {
      expect(dateFilterBounds.x).toBeGreaterThan(hasFoodBounds.x);
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
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    }
    await page.getByRole("option", { name: "Today" }).click();
    await expect(page.getByRole("button", { name: "Event: Tech Career Fair", exact: true })).toHaveCount(0);

    await dateFilter.click();
    await page.getByRole("option", { name: "Tomorrow" }).click();
    await expect(page.getByRole("button", { name: "Event: Tech Career Fair", exact: true })).toBeVisible();

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
    await expect(page.getByRole("button", { name: "Event: Tech Career Fair", exact: true })).toBeVisible();
  });

  test("renders borderless event card content without horizontal padding", async ({
    page,
  }) => {
    await page.goto(BASE);

    const card = page.locator("article[data-event-id]:visible").first();
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

    const clubBadge = card.locator('[data-slot="club-badge"]');
    await expect(clubBadge).toHaveCSS("opacity", "1");
    await card.hover();
    await expect(card).toHaveCSS("opacity", "1");
    await expect(clubBadge).toHaveCSS("opacity", "1");
    await expect(
      card.locator('xpath=ancestor::*[@data-slot="card-grid"]'),
    ).toHaveCSS("column-gap", "20px");
  });

  test("rounds the event card image's bottom-right corner", async ({ page }) => {
    await page.goto(BASE);

    const cardImage = page
      .locator(
        'article[data-event-id]:visible [data-slot="event-card-image"][data-variant="card"]',
      )
      .first();
    await expect(cardImage).toBeVisible();
    await expect(cardImage).toHaveCSS("border-bottom-right-radius", "12px");
  });

  test("keeps chronological ordering when client-side filters change", async ({
    page, next,
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
      club_id: 1,
      club: "UW Tech Club",
      club_type: "wusa",
      club_page: null,
      club_ig: "uwtechclub",
      club_discord: null,
      school: "uwaterloo",
      added_at: new Date(now - addedHoursAgo * 3_600_000).toISOString(),
    });
    const chronologicalEvents = [
      event(11, "Soon Event", 1, 3),
      event(12, "Middle Event", 2, 2),
      event(13, "Later Event", 3, 1),
    ];

    await mockApi(page, next, url => apiPath(url) === "/events", async () => {
      return ({
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
    const cards = page.locator("article[data-event-id]:visible");
    await expect(cards).toHaveCount(3);

    const newlyAddedSelect = page.getByRole("button", { name: "New", exact: true });
    await newlyAddedSelect.click();
    await page.getByRole("dialog").getByRole("button", { name: "New", exact: true }).click();

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

    const newBadges = page.locator("article:visible").getByText("NEW", { exact: true });
    await expect.poll(() => newBadges.count()).toBeGreaterThan(0);
    const newBadge = newBadges.first();
    const geometry = await newBadge.evaluate((element) => {
      const card = element.closest("article[data-event-card]");
      const mask = card?.querySelector("mask");
      const svg = mask?.ownerSVGElement;
      const viewBox = svg?.viewBox.baseVal;
      const svgBounds = svg?.getBoundingClientRect();
      const badgeBounds = element.getBoundingClientRect();
      const clubBadgeBounds = card
        ?.querySelector('[data-slot="club-badge"]')
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
          bottomCutoutRight - (clubBadgeBounds?.right ?? 0),
        bottomLeftTopGap:
          (clubBadgeBounds?.top ?? 0) - bottomCutoutTop,
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

    expect(geometry.topLeftRightGap).toBeCloseTo(4, 0);
    expect(geometry.topLeftBottomGap).toBeCloseTo(4, 0);
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

  test("More filters excludes view and category controls", async ({ page }) => {
    await page.goto(BASE);

    const moreFiltersButton = page.getByRole("button", { name: "More filters" });
    await moreFiltersButton.click();

    const drawer = page.getByRole("dialog", { name: "More filters" });
    await expect(drawer.getByRole("button", { name: "Grid" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Calendar" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Career", exact: true })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Clear filters" }),
    ).toHaveCount(0);
  });

  test("loads server categories reactively and clears their selection", async ({ page, next }) => {
    let constantsRequests = 0;
    let releaseConstants!: () => void;
    const constantsGate = new Promise<void>(resolve => { releaseConstants = resolve; });
    await mockApi(page, next, url => apiPath(url) === "/meta/constants", async () => {
      constantsRequests += 1;
      await constantsGate;
      return { json: {
        event_categories: ["Career", "Technology"],
        club_categories: ["Technology", "Social"],
        interests: ["Career", "Technology"],
        interest_to_categories: { Career: ["Career"], Technology: ["Technology"] },
        report_statuses: ["pending", "resolved", "dismissed"],
      } };
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Arts & Culture", exact: true })).toBeVisible();
    const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/meta/constants");
    releaseConstants();
    await response;
    const categoryButton = page.getByRole("button", { name: "Career", exact: true });
    await expect(categoryButton).toBeVisible();
    await expect(page.getByRole("button", { name: "Arts & Culture", exact: true })).toHaveCount(0);
    expect(constantsRequests).toBe(1);
    await categoryButton.click();
    await expect(categoryButton).toHaveAttribute("aria-pressed", "true");
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

  test("keeps categories inclusive while requiring every selected weekday and other filter", async ({ page, next }) => {
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    monday.setUTCHours(17, 0, 0, 0);
    const tuesday = new Date(monday.getTime() + 86400000);
    const events = [[monday, tuesday], [monday], [tuesday]].map((dates, index) => ({
      id: index + 1, title: `Filter test ${index + 1}`, location: "SLC",
      club: "UW Tech Club", school: "uwaterloo", price: 0, food: ["Pizza"],
      category: index === 0 ? "Technology" : "Career", added_at: new Date().toISOString(),
      registration: false, occurrences: dates.map((date, occurrenceIndex) => ({
        id: `${index}-${occurrenceIndex}`, event_id: index + 1,
        dtstart_utc: date.toISOString(), dtend_utc: null, tz: "America/Toronto",
      })),
    }));
    await mockApi(page, next, url => apiPath(url) === "/events", async () => ({
      json: { items: events, total: 3, page: 1, page_size: 100, total_pages: 1 },
    }));
    await page.goto(BASE);
    await page.getByRole("button", { name: "Career", exact: true }).click();
    await page.getByRole("button", { name: "Technology", exact: true }).click();
    const cards = page.locator("article[data-event-id]:visible");
    await expect(cards).toHaveCount(3);
    await page.getByRole("button", { name: "More filters" }).click();
    const drawer = page.getByRole("dialog", { name: "More filters" });
    await drawer.getByRole("button", { name: "Monday", exact: true }).click();
    await expect(cards).toHaveCount(2);
    await drawer.getByRole("button", { name: "Tuesday", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-event-id", "1");
    await drawer.getByPlaceholder("Search food...").fill("Soup");
    await expect(cards).toHaveCount(0);
    await drawer.getByPlaceholder("Search food...").clear();
    await expect(cards).toHaveCount(1);
    await drawer.getByRole("button", { name: "Monday", exact: true }).click();
    await expect(cards).toHaveCount(2);
  });

  test("filters free-text fields and price range, then restores all events", async ({
    page, next,
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
      club: "UW Tech Club",
      club_type: "wusa",
      school: "uwaterloo",
      added_at: now.toISOString(),
    };

    await mockApi(page, next, url => apiPath(url) === "/events", async () => {
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
          club: "Campus Food Society",
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
          club: "Student Life Club",
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

      return ({
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
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(3);
    const pizzaCard = page.locator('article[data-event-id="2"]:visible');
    await expect(pizzaCard).toContainText("Pizza");
    await expect(pizzaCard).not.toContainText("Cookies");
    for (const label of ["$12", "Pizza"]) {
      await expect(pizzaCard.getByText(label, { exact: true })).toHaveCSS("font-size", "11px");
    }
    const genericFoodCard = page.locator('article[data-event-id="3"]:visible');
    await expect(genericFoodCard).toContainText("Food");
    await expect(genericFoodCard).not.toContainText("Yes!");

    await page.getByRole("button", { name: "More filters" }).click();
    const drawer = page.getByRole("dialog", { name: "More filters" });
    const foodInput = drawer.getByPlaceholder("Search food...");
    await foodInput.fill("piz");

    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();

    await foodInput.clear();
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(3);

    const clubInput = drawer.getByPlaceholder("Search club...");
    await clubInput.fill("food");
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();
    await clubInput.clear();
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(3);

    const minPriceInput = drawer.getByRole("spinbutton", { name: "Min" });
    const maxPriceInput = drawer.getByRole("spinbutton", { name: "Max" });
    await minPriceInput.fill("1");
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(1);
    await expect(pizzaCard).toBeVisible();
    await minPriceInput.clear();
    await maxPriceInput.fill("0");
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(2);
    await maxPriceInput.clear();
    await expect(page.locator("article[data-event-id]:visible")).toHaveCount(3);
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
      .map((event: { title: string; category?: string; club?: string | null }) =>
        `${event.title} ${event.category ?? ""} ${event.club ?? ""}`.toLowerCase(),
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

// ── Workflow 3: Clubs Page ────────────────────────────────────

test("Free and Food are independent toggles", async ({ page }) => {
  await page.goto(BASE);
  const filters = page.getByTestId("event-quick-filter-scroll");
  const free = filters.getByRole("button", { name: "Free", exact: true });
  const food = filters.getByRole("button", { name: "Food", exact: true });
  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await expect(free).toHaveAttribute("aria-pressed", "false");
  await free.click();
  await expect(free).toHaveAttribute("aria-pressed", "true");
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "false");
  await expect(free).toHaveAttribute("aria-pressed", "true");
});

test("New toggles directly without a dropdown or All button", async ({ page }) => {
  await page.goto(BASE);
  const filters = page.getByTestId("event-quick-filter-scroll");
  await expect(filters.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
  const trigger = filters.getByRole("button", { name: "New", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
});

test.describe("Clubs Page", () => {
  test("uses club URLs and puts Positions before Clubs", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/clubs`);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" }).first();
    const links = navigation.getByRole("link");
    const destinations = await links.evaluateAll(elements => elements.map(element => element.getAttribute("href")));
    expect(destinations.indexOf("/positions")).toBeLessThan(destinations.indexOf("/clubs"));
    expect(destinations).not.toContain("/organizations");
  });
  test("filters clubs by minimum event count and restores zero-event clubs", async ({ page }) => {
    await page.goto(`${BASE}/clubs`);
    await expect(page.locator("[data-club-id]")).toHaveCount(3);
    const minimum = page.getByRole("spinbutton", { name: "Minimum events" });
    expect(await minimum.evaluate(element => {
      const input = element as HTMLInputElement;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      const style = getComputedStyle(input);
      context.font = style.font;
      return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20 >= context.measureText(input.placeholder).width;
    })).toBe(true);
    const request = page.waitForRequest(request => new URL(request.url()).searchParams.get("min_events") === "1");
    await minimum.fill("1");
    await request;
    await expect(page.locator("[data-club-id]")).toHaveCount(2);
    await expect(page.locator('[data-club-id="3"]')).toHaveCount(0);
    await minimum.fill("0");
    await expect(page.locator("[data-club-id]")).toHaveCount(3);
  });

  test("loads and displays clubs", async ({ page }) => {
    await page.goto(`${BASE}/clubs`);
    await page.waitForTimeout(3000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    const clubCard = page.locator('[data-club-id="1"]');
    const clubContent = clubCard.locator(
      '[data-slot="event-card-content"]',
    );
    const addClubButton = page.getByRole("button", {
      name: "Add club",
      exact: true,
    });
    const clubSearch = page.getByPlaceholder("Search clubs...").locator("..");
    const clubScope = page.getByRole("combobox", { name: "All", exact: true });
    await expect(
      page.getByRole("heading", { name: /student clubs/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/Explore student communities/i)).toHaveCount(0);
    await expect(addClubButton.locator("svg")).toHaveCount(0);
    await expect(
      clubCard.getByRole("link", { name: "View Club Page" }),
    ).toBeVisible();
    await expect(
      clubCard.getByRole("button", { name: "More options" }),
    ).toHaveCount(0);
    await expect(clubContent).toHaveCSS("padding-left", "12px");
    await expect(clubContent).toHaveCSS("padding-right", "12px");
    await expect(
      clubCard.locator('xpath=ancestor::*[@data-slot="card-grid"]'),
    ).toHaveCSS("column-gap", "20px");
    await expect
      .poll(async () => {
        const [
          searchBox,
          scopeBox,
          addClubBox,
          scopeBesideCategoryStrip,
        ] = await Promise.all([
          clubSearch.boundingBox(),
          clubScope.boundingBox(),
          addClubButton.boundingBox(),
          page
            .getByTestId("club-category-filter-scroll")
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
          sharesSearchRow: Boolean(searchBox && addClubBox && Math.abs(searchBox.y - addClubBox.y) < 1 && addClubBox.x >= searchBox.x + searchBox.width),
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

    await page.screenshot({ path: "e2e/screenshots/clubs-page.png", fullPage: true });
  });

  test("keeps club listing controls fixed while scrolling on mobile", async ({ page, next }) => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...MOCK_CLUBS[index % MOCK_CLUBS.length],
      id: index + 1,
      club_name: `Campus Club ${index + 1}`,
    }));
    await mockApi(page, next, url => apiPath(url) === "/clubs", async () => ({
      json: { items, total: items.length, page: 1, page_size: 30, total_pages: 1 },
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/clubs`);
    await expect(page.locator('[data-club-id="30"]')).toBeAttached();
    await expect(page.locator('[data-club-id="1"]')).toHaveCSS("isolation", "isolate");
    const search = page.getByPlaceholder("Search clubs...");
    const initial = await search.boundingBox();
    expect(initial).not.toBeNull();
    const scrollRoot = page.locator(".main-content-grid:visible");
    const header = page.locator('[data-slot="page-header"]');
    await expect(scrollRoot).toHaveCSS("padding-top", "0px");
    await expect(header).toHaveCSS("margin-top", "0px");
    await expect(header).toHaveCSS("padding-top", "16px");
    expect(await header.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(Math.abs((await header.boundingBox())!.y - (await scrollRoot.boundingBox())!.y)).toBeLessThan(2);
    await expect(scrollRoot).toHaveCSS("overflow-y", "auto");
    await scrollRoot.evaluate(element => { element.scrollTop = 600; });
    await expect.poll(() => scrollRoot.evaluate(element => element.scrollTop)).toBeGreaterThan(400);
    await expect.poll(async () => (await search.boundingBox())?.y).toBe(initial!.y);
    await expect(page.getByRole("button", { name: "Add club", exact: true })).toBeInViewport();
  });

  test("app API proxy returns clubs", async ({ request }) => {
    const res = await request.get(`${APP_API}/clubs/`);
    expect(res.status()).toBe(200);
    const clubs = await res.json();
    expect(clubs.items.length).toBeGreaterThan(0);
    expect(clubs.items[0]).toHaveProperty("club_name");
    expect(clubs.items[0]).toHaveProperty("club_type");
  });

  test("app API proxy preserves the club paginated contract", async ({ request }) => {
    const res = await request.get(`${APP_API}/clubs/`);
    const clubs = await res.json();
    expect(clubs.total).toBeGreaterThanOrEqual(clubs.items.length);
    expect(
      clubs.items.every(
        (club: { club_name?: string; club_type?: string }) =>
          typeof club.club_name === "string" &&
          typeof club.club_type === "string",
      ),
    ).toBeTruthy();
  });

  test("club search filter works through app API proxy", async ({ request }) => {
    const res = await request.get(`${APP_API}/clubs/?search=computer`);
    expect(res.status()).toBe(200);
    const clubs = await res.json();
    expect(clubs.items.length).toBeGreaterThanOrEqual(1);
    const searchableText = clubs.items
      .map((club: { club_name: string; categories?: string[] }) =>
        `${club.club_name} ${(club.categories ?? []).join(" ")}`.toLowerCase(),
      )
      .join(" ");
    expect(searchableText).toContain("computer");
  });
});

// ── Workflow 4: Onboarding Page ───────────────────────────────────────

test.describe("Onboarding Page", () => {
  test("loads faculty choices from the selected school instead of Waterloo", async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/schools", async () => {
      return ({ json: [{
        slug: "mcmaster", timezone: "America/Toronto", name: "McMaster University", language: "en",
        primary_color: "#7A003C", secondary_color: "#FDBF57",
        email_domains: ["mcmaster.ca"],
        faculties: ["DeGroote School of Business", "Engineering", "Health Sciences", "Humanities", "Science", "Social Sciences"],
      }] });
    });
    await page.goto(`${BASE}/onboarding?school=mcmaster`);
    for (let step = 0; step < 4; step += 1) {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(2);
    const faculty = page.getByRole("main").getByRole("combobox").last();
    await faculty.click();
    await expect(page.getByRole("option", { name: "DeGroote School of Business", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Mathematics", exact: true })).toHaveCount(0);
  });

  test("renders onboarding steps", async ({ page }) => {
    await page.goto(`${BASE}/onboarding`);
    await page.waitForTimeout(1000);

    const body = await page.textContent("body");
    expect(body).toBeTruthy();

    await page.screenshot({ path: "e2e/screenshots/onboarding-page.png", fullPage: true });
  });
});

// ── Workflow 5: Auth-protected endpoints ──────────────────────────────

test("admin events show schools without status and use matching filter sizes", async ({ page, next }) => {
  await seedAuthenticatedSession(page, next);
  await mockApi(page, next, url => apiPath(url) === "/submissions", async () => ({
    json: { items: [], total: 0, page: 1, page_size: 20, total_pages: 0 },
  }));
  await mockApi(page, next, url => apiPath(url) === "/reports", async () => ({
    json: { items: [], total: 0, page: 1, page_size: 20, total_pages: 0 },
  }));
  await page.goto(`${BASE}/admin/events`);
  const eventsTab = page.getByRole("tab", { name: "Events List", exact: true });
  const submissionsTab = page.getByRole("tab", { name: /Event Submissions/ });
  await expect(eventsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.getByRole("columnheader", { name: "School", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "uwaterloo", exact: true })).toBeVisible();
  const reported = page.getByRole("button", { name: "Reported Only", exact: true });
  const search = page.getByPlaceholder("Search events...");
  const category = page.getByRole("combobox").filter({ hasText: "All Categories" });
  await expect(reported).toHaveCount(0);
  await expect(search).toHaveCSS("height", "44px");
  await expect(category).toHaveCSS("height", "44px");
  const reportsTab = page.getByRole("tab", { name: "Event reports", exact: true });
  await reportsTab.click();
  await expect(reportsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "No pending event reports", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "uwaterloo", exact: true })).toHaveCount(0);
  await eventsTab.click();
  await expect(page.getByRole("cell", { name: "uwaterloo", exact: true })).toBeVisible();
  await submissionsTab.click();
  await expect(submissionsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(reported).toHaveCount(0);
  await eventsTab.click();
  await expect(page.getByRole("cell", { name: "uwaterloo", exact: true })).toBeVisible();
});

for (const [profileCount, totalCount, overflow] of [[0, 1, 0], [1, 1, 0], [8, 9, 1]]) {
  test(`shows ${profileCount} attendee pictures and only real overflow for ${totalCount} going`, async ({ page, next }) => {
    const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="blue"/></svg>');
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => ({ json: {
      id: 1, title: "Attendee profiles", school: "uwaterloo", club_id: 1, club: "UW Tech Club",
      description: "", location: "SLC", category: "Career", price: 0, food: [], registration: false,
      cancelled: false, occurrences: [{ id: "occurrence-1", event_id: 1,
        dtstart_utc: new Date(Date.now() + 86400000).toISOString(), dtend_utc: null }],
    } }));
    await mockApi(page, next, url => apiPath(url) === "/going-events/1/attendees", async () => ({ json: {
      going_count: totalCount,
      attendees: Array.from({ length: profileCount }, () => ({ name: "", avatar_url: avatar })),
    } }));
    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]:visible').click();
    const stack = page.getByRole("dialog").locator('[data-slot="avatar-stack"]');
    await expect(stack.getByRole("img", { name: "Going", exact: true })).toHaveCount(profileCount);
    await expect(stack.getByText("+1", { exact: true })).toHaveCount(overflow);
  });
}

for (const surface of ["drawer", "page"]) {
  test(`refreshes attendance and avatar stack after Going in the ${surface}`, async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="blue"/></svg>');
    let going = false;
    const occurrenceId = "00000000-0000-4000-8000-000000000001";
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => ({ json: {
      id: 1, title: "Attendance test", school: "uwaterloo", club_id: 1, club: "UW Tech Club",
      club_logo_url: avatar, club_type: "independent",
      description: "", location: "SLC", category: "Career", price: 0, food: [], registration: false,
      cancelled: false, occurrences: [{ id: occurrenceId, event_id: 1,
        dtstart_utc: new Date(Date.now() + 86400000).toISOString(), dtend_utc: null }],
    } }));
    await mockApi(page, next, url => apiPath(url) === "/going-events/1/attendees", async () => ({ json: {
      going_count: going ? 1 : 0,
      attendees: going ? [{ name: "Test U.", avatar_url: avatar }] : [],
    } }));
    await mockApi(page, next, url => apiPath(url) === "/going-events/1", async request => {
      going = request.method !== "DELETE";
      return { json: { status: going ? "going" : "not_going", event_id: 1,
        occurrence_ids: going ? [occurrenceId] : [], going_count: going ? 1 : 0 } };
    });
    await page.goto(surface === "page" ? `${BASE}/events/1` : BASE);
    if (surface === "drawer") await page.locator('article[data-event-id="1"]:visible').click();
    const content = surface === "drawer" ? page.getByRole("dialog") : page.locator("body");
    await expect(content.locator('[data-slot="event-host-links"]')).toHaveCount(0);
    await expect(content.locator('[data-slot="avatar-stack"]')).toHaveCount(0);
    await expect(content.locator('[data-slot="club-badge"]').last().locator("img")).toHaveAttribute("src", avatar);
    await content.getByRole("button", { name: "Going", exact: true }).click();
    await expect(content.getByRole("heading", { name: "1 going", exact: true })).toBeVisible();
    await expect(content.locator('[data-slot="avatar-stack"]').getByRole("img", { name: "Test U." })).toBeVisible();
    const cancel = content.getByRole("button", { name: /marking yourself not going/i });
    await expect(cancel).toHaveCSS("text-decoration-line", "underline");
    await cancel.click();
    await expect(content.locator('[data-slot="avatar-stack"]')).toHaveCount(0);
  });
}

for (const [detail, message] of [
  ["One or more occurrences can no longer be selected", "This event has already started or was cancelled, so you can’t mark Going."],
  ["Unexpected storage failure", "Couldn't save your selected time"],
]) {
  test(`Going rejection toast: ${detail}`, async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await mockApi(page, next, url => apiPath(url) === "/going-events/1/attendees", async () => ({
      json: { going_count: 0, attendees: [] },
    }));
    await mockApi(page, next, url => apiPath(url) === "/events/1", async () => ({ json: {
      id: 1, title: "Going toast test", school: "uwaterloo", club_id: 1, club: "UW Tech Club",
      description: "", location: "SLC", category: "Career", price: 0, food: [], registration: false,
      cancelled: false, occurrences: [{ id: "00000000-0000-4000-8000-000000000001", event_id: 1,
        dtstart_utc: new Date(Date.now() - 60000).toISOString(),
        dtend_utc: new Date(Date.now() + 3600000).toISOString() }],
    } }));
    await mockApi(page, next, url => apiPath(url) === "/going-events/1", async () => ({
      status: 400, json: { detail },
    }));
    await page.goto(BASE);
    await page.locator('article[data-event-id="1"]:visible').click();
    await page.getByRole("dialog").getByRole("button", { name: "Going", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
    await expect(page.getByRole("dialog").locator('[data-slot="avatar-stack"]')).toHaveCount(0);
  });
}

for (const route of ["/", "/positions", "/clubs"]) {
  test(`listing header background spans the viewport on ${route}`, async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}${route}`);
      const header = page.locator('[data-slot="page-header"][data-variant="listing"]:visible');
      await expect(header).toBeVisible();
      await expect(header).toHaveCSS("position", "sticky");
      await expect.poll(() => header.evaluate(element => {
        const background = getComputedStyle(element, "::before");
        const rect = element.getBoundingClientRect();
        const left = rect.left + rect.width / 2 - parseFloat(background.width) / 2;
        return background.backgroundColor === getComputedStyle(element).backgroundColor
          && left <= 1
          && left + parseFloat(background.width) >= document.documentElement.clientWidth - 1;
      })).toBe(true);
      const scrollRoot = page.locator(".main-content-grid:visible");
      await expect(scrollRoot).toHaveCSS("overflow-x", "hidden");
    }
  });
}

test("direct admin clubs visits load both pending tab counts", async ({ page, next }) => {
  await seedAuthenticatedSession(page, next);
  await mockApi(page, next, url => apiPath(url) === "/clubs/claims", async () => ({
    json: { items: ["pending"].map((status, index) => ({
      id: `claim-${index}`, club_id: 1, user_id: "mock-user-id", status,
      executive_role: "President", created_at: new Date().toISOString(),
      clubs: MOCK_CLUBS[0], users: { email: TEST_EMAIL, full_name: "Test User" },
    })), total: 1, page: 1, page_size: 1, total_pages: 1 },
  }));
  const items = ["pending", "pending"].map((status, index) => ({
    ...MOCK_CLUBS[0], id: index + 10, status,
  }));
  await mockApi(page, next, url => apiPath(url) === "/clubs/review", async () => ({
    json: { items, total: 2, page: 1, page_size: 20, total_pages: 1 },
  }));

  await page.goto(`${BASE}/admin/clubs`);

  await expect(page.getByRole("tab", { name: "Clubs List", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Claim Requests 1", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Club submissions 2", exact: true })).toBeVisible();
});

test("claim status badges hug their content inside drawers", async ({ page, next }) => {
  await seedAuthenticatedSession(page, next);
  await mockApi(page, next, url => apiPath(url) === "/clubs/claims", async () => ({
    json: { items: [{
      id: "pending-claim", club_id: 1, user_id: "mock-user-id", status: "pending",
      executive_role: "President", created_at: new Date().toISOString(),
      clubs: MOCK_CLUBS[0], users: { email: TEST_EMAIL, full_name: "Test User" },
    }], total: 1, page: 1, page_size: 20, total_pages: 1 },
  }));
  await page.goto(`${BASE}/admin/clubs?tab=claims`);
  await page.getByRole("row").filter({ hasText: "President" }).getByRole("button", { name: "View", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Claim Requests", exact: true });
  const badge = drawer.getByText("Pending", { exact: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(badge).toBeVisible();
    await expect.poll(() => badge.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const style = getComputedStyle(element);
      const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      return Math.abs(element.getBoundingClientRect().width - range.getBoundingClientRect().width - inset) < 2;
    })).toBe(true);
  }
});

test("club submissions use consistent naming and show multiple schools", async ({ page, next }) => {
  await seedAuthenticatedSession(page, next);
  const items = ["uwaterloo", "ualberta", "ulaval"].map((school, index) => ({
    ...MOCK_CLUBS[0], id: index + 10, school, status: "pending",
    club_name: `Demo ${school} Submission Club`, owner_email: `${school}@example.invalid`,
  }));
  await mockApi(page, next, url => apiPath(url) === "/clubs/review", async () => ({
    json: { items, total: 3, page: 1, page_size: 20, total_pages: 1 },
  }));
  await page.goto(`${BASE}/admin/clubs?tab=submissions`);
  await expect(page.getByRole("tab", { name: /Club submissions/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Club Reviews/i })).toHaveCount(0);
  for (const item of items) {
    await expect(page.getByText(item.club_name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("columnheader", { name: "School", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "School", exact: true }).click();
  await page.getByRole("option", { name: "University of Waterloo", exact: true }).click();
  await expect(page.getByText(items[0].club_name, { exact: true })).toBeVisible();
  await expect(page.getByText(items[1].club_name, { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Search", { exact: true }).fill("no matching submission");
  await expect(page.getByText(items[0].club_name, { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Search", { exact: true }).fill("");
  await expect(page.getByText(items[0].club_name, { exact: true })).toBeVisible();
});

test("location examples arrive in HTML without a browser school request", async ({ page, next }) => {
  const schools = MOCK_SCHOOLS.map(school => ({ ...school, location_examples: ["Server-provided hall"] }));
  await mockApi(page, next, url => apiPath(url) === "/schools", async () => ({ json: schools }));
  const schoolRequests: string[] = [];
  page.on("request", request => {
    if (apiPath(new URL(request.url())) === "/schools") schoolRequests.push(request.url());
  });
  const response = await page.goto(BASE);
  expect(await response!.text()).toContain("Server-provided hall");
  await page.getByRole("button", { name: "More filters", exact: true }).click();
  await expect(page.getByPlaceholder("Server-provided hall", { exact: true })).toBeVisible();
  expect(schoolRequests).toEqual([]);
});

test.describe("Auth-protected API endpoints", () => {
  test("position submissions preserve the API proxy without redirects", async ({ request }) => {
    const url = `${APP_API}/position-submissions/`;
    const listing = await request.get(`${url}?page=1&page_size=20`, {
      maxRedirects: 0,
    });
    expect(listing.status()).toBe(401);
    expect(listing.headers().location).toBeUndefined();

    const submission = await request.post(url, {
      data: { position_data: { title: "Test" } },
      maxRedirects: 0,
    });
    expect(submission.status()).toBe(401);
    expect(submission.headers().location).toBeUndefined();
  });

  test("POST /events/ requires authentication", async ({ request }) => {
    const res = await request.post(`${APP_API}/events/`, {
      data: { title: "Test", location: "Test" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("POST /clubs/ requires authentication", async ({ request }) => {
    const res = await request.post(`${APP_API}/clubs/`, {
      data: {
        club_name: "Test",
        club_type: "independent",
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
  test("failed flyer extraction opens the manual event form", async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/ai/parse-event-image", async () => ({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "No event could be read from this image." }),
    }));
    await page.goto(`${BASE}/events/submit`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "event.png", mimeType: "image/png", buffer: Buffer.from("event-image"),
    });
    await expect(page.getByRole("textbox", { name: /Event Title/ })).toBeVisible();
    await page.getByRole("textbox", { name: /Event Title/ }).fill("Manually entered event");
    await expect(page.getByRole("textbox", { name: /Event Title/ })).toHaveValue("Manually entered event");
  });

  test("dismissing filters with Escape preserves the selected date", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("combobox", { name: "Event date" }).click();
    await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
    await page.getByRole("button", { name: "More filters", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "More filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "More filters" })).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Event date" })).toHaveText("Tomorrow");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Event date" })).toHaveText("Any day");
  });

  test("stale session can still access event submission as anonymous", async ({
    page, next,
  }) => {
    await mockApi(page, next, url => apiPath(url) === "/auth/refresh", async () => {
      return ({
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
    page, next,
  }) => {
    const portraitFlyerDataUrl = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#5b9bff"/></svg>',
    )}`;
    let parseAuthorization: string | null = null;
    let parseRequestCount = 0;
    await mockApi(page, next, url => apiPath(url) === "/ai/parse-event-image", async (request) => {
        parseRequestCount += 1;
        parseAuthorization =
          request.headers.get("authorization") ?? null;
        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            club_id: null,
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
      });

    await page.goto(`${BASE}/events/submit`);
    await page.waitForLoadState("networkidle");
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

    await expect(page.getByRole("textbox", { name: /Event Title/ })).toHaveValue(
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

  test("UTM hostname owns event and club submission context", async ({
    page, next,
  }) => {
    await seedAuthenticatedSession(page, next);
    let requestedClubSchool: string | null = null;
    let requestedExtractionSchool: string | null = null;

    await mockApi(page, next, url => apiPath(url) === "/clubs", async (request) => {
      requestedClubSchool = new URL(
        request.url,
      ).searchParams.get("school");
      return ({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              ...MOCK_CLUBS[0],
              id: 91,
              club_name: "UTM Campus Club",
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
    await mockApi(page, next, url => apiPath(url) === "/ai/parse-event-image", async (request) => {
        requestedExtractionSchool = new URL(request.url).searchParams.get("school");
        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            club_id: null,
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
      });

    const utmBase = "http://utm.wat2do.localhost:3000";
    await page.goto(`${utmBase}/events/submit`);

    await expect(
      page.getByRole("heading", {
        name: "Submit Event",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Only clubs from University of Toronto Mississauga are shown",
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
      .poll(() => requestedClubSchool)
      .toBe("utm");
    expect(requestedExtractionSchool).toBe("utm");
    const clubInput = page.getByRole("textbox", {
      name: "Club",
    });
    await expect(clubInput).toBeVisible();
    await clubInput.fill("UTM Campus Club");
    await expect(clubInput).toHaveValue("UTM Campus Club");
    await expect(
      page.getByText("UTM Campus Club", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Club" }),
    ).toHaveCount(0);

    await page.goto(`${utmBase}/clubs/new`);
    await expect(
      page.getByRole("heading", {
        name: "Submit Club",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This club will be listed for University of Toronto Mississauga.",
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
    const routes = ["/", "/login", "/onboarding", "/clubs", "/contact", "/settings"];
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
      { url: "http://utsg.wat2do.localhost:3000/", schoolName: "University of Toronto" },
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
    await page.waitForLoadState("networkidle");

    const schoolTrigger = page.locator('[data-slot="top-nav"]')
      .getByRole("button", { name: "University of Waterloo" });
    await schoolTrigger.hover();
    await expect(schoolTrigger).toHaveAttribute("aria-expanded", "false");
    await schoolTrigger.click();
    await expect(schoolTrigger).toHaveAttribute("aria-expanded", "true");

    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("dialog")
        .getByRole("option", { name: "University of Waterloo" }),
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
      "Clubs",
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
      topNavigation.getByRole("button", { name: "Sign In", exact: true }),
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
    ).toHaveText("Sign In");
    await expect(
      navigationDrawer.getByRole("link", { name: "Events", exact: true }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("button", { name: "Sign In", exact: true }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("combobox").filter({ hasText: "English" }),
    ).toBeVisible();
    await expect(
      navigationDrawer.getByRole("button", { name: "Switch to dark mode" }),
    ).toBeVisible();
  });

  test("account actions live in the compact sidecar and club selection stays out of the main bar", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    const topNavigation = page.getByRole("banner");
    await expect(topNavigation.getByRole("button", { name: "Admin", exact: true })).toBeHidden();
    await expect(topNavigation.getByRole("button", { name: "Log out", exact: true })).toBeHidden();
    await expect(topNavigation.getByRole("button", { name: "UW Tech Club", exact: true })).toHaveCount(0);
    await topNavigation.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(drawer.getByRole("button", { name: "UW Tech Club", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(drawer).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(topNavigation.getByRole("button", { name: "UW Tech Club", exact: true })).toHaveCount(0);
    await expect(topNavigation.getByRole("button", { name: "Log out", exact: true })).toHaveCount(0);
    await topNavigation.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(drawer.getByRole("button", { name: "UW Tech Club", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      ({ themeKey }) => localStorage.setItem(themeKey, JSON.stringify("dark")),
      { themeKey: STORAGE_KEYS.THEME },
    );
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
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
    const toggleBounds = await darkThemeToggle.boundingBox();
    expect(toggleBounds).not.toBeNull();
    const clickPosition = { x: 6, y: 6 };
    const origin = {
      x: Math.floor(toggleBounds!.x + clickPosition.x),
      y: Math.floor(toggleBounds!.y + clickPosition.y),
    };
    const viewport = page.viewportSize()!;
    const radius = Math.hypot(
      Math.max(origin.x, viewport.width - origin.x),
      Math.max(origin.y, viewport.height - origin.y),
    );
    await darkThemeToggle.click({ position: clickPosition });
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
    const outlineBorder = await page.evaluate(() => {
      const sample = document.createElement("button");
      sample.className = "border-border/60";
      document.body.append(sample);
      const color = getComputedStyle(sample).borderTopColor;
      sample.remove();
      return color;
    });
    await expect(lightThemeToggle).toHaveCSS("border-top-color", outlineBorder);
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
          `circle(0px at ${origin.x}px ${origin.y}px)`,
          `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
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
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Open navigation menu" }).click();
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

  test("changes theme without a view transition when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BASE);
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.evaluate(() => {
      document.startViewTransition = () => {
        throw new Error("Reduced motion must not start a view transition");
      };
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).not.toHaveClass(/no-transitions/);
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(errors).toEqual([]);
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

    await expect(page.locator('[data-slot="top-nav"]')).toBeVisible();
    await expect(page.getByRole("main", { name: "Events list" })).toBeVisible();
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

test.describe("Position submissions", () => {
  test("drops a poster, submits a paid role, and approves it through admin review", async ({ page, next }) => {
    await seedAuthenticatedSession(page, next);
    const positionData = { title: "Design Lead", description: "Design posters for campus activities.", position_type: "committee", requirements: ["Design experience"], is_paid: true, source_image_url: "https://example.com/poster.png" };
    const submission = { id: "00000000-0000-4000-9000-000000000001", user_id: null, position_data: { ...positionData, club_id: 1, source_url: "https://example.com/jobs/design" }, status: "pending", submitted_at: new Date().toISOString(), submitted_by_email: TEST_EMAIL };
    let submitted: Record<string, unknown> | null = null;
    let reviewed = false;
    await mockApi(page, next, url => apiPath(url) === "/ai/parse-position-image", async request => {
      expect(new URL(request.url).searchParams.get("school")).toBe("uwaterloo");
      return ({ json: positionData });
    });
    await mockApi(page, next, url => apiPath(url) === "/position-submissions", async request => {
      if (request.method === "POST") {
        submitted = (await request.json());
        return ({ status: 201, json: submission });
      } else {
        if (new URL(request.url).searchParams.get("submission_status") === "pending") {
          return { json: { items: reviewed ? [] : [submission], total: reviewed ? 0 : 1, page: 1, page_size: 20, total_pages: reviewed ? 0 : 1 } };
        }
        return ({ json: { items: [{ ...submission, status: reviewed ? "approved" : "pending" }], total: 21, page: 1, page_size: 20, total_pages: 2 } });
      }
    });
    await mockApi(page, next, url => apiPath(url) === "/position-submissions/" + submission.id, async request => {
      expect((await request.json()).status).toBe("approved");
      reviewed = true;
      return ({ json: { ...submission, status: "approved" } });
    });
    await mockApi(page, next, url => apiPath(url) === "/positions", () => ({ json: { items: [], total: 0, page: 1, page_size: 20, total_pages: 0, latest_added_position: null } }));
    await mockApi(page, next, url => apiPath(url) === "/clubs/1", () => ({ json: MOCK_CLUBS[0] }));
    await page.goto(`${BASE}/positions/submit`);
    const title = page.getByRole("textbox", { name: "Position title" });
    await expect(title).toBeVisible();
    const form = title.locator("xpath=ancestor::form");
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "poster.png", { type: "image/png" }));
      return data;
    });
    await form.locator('input[type="file"]').locator("..").dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(title).toHaveValue("Design Lead");
    await form.locator("#position-club").click();
    const clubSearch = page.getByPlaceholder("Search clubs...");
    await clubSearch.fill("UW Tech");
    await clubSearch.press("Enter");
    await form.getByRole("textbox", { name: "Source link" }).fill("https://example.com/jobs/design");
    await form.getByRole("button", { name: "Submit for Review" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Position submitted for review." })).toBeVisible();
    expect(submitted).toMatchObject({ position_data: { club_id: 1, is_paid: true, title: "Design Lead" } });
    expect(submitted).not.toHaveProperty("position_data.school");
    await page.goto(`${BASE}/admin/positions`);
    const positionsTab = page.getByRole("tab", { name: "Positions", exact: true });
    const submissionsTab = page.getByRole("tab", { name: /^Position submissions/ });
    await expect(submissionsTab.locator('[data-slot="tabs-count"]')).toHaveText("1");
    await expect(positionsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Design Lead" })).toHaveCount(0);
    await submissionsTab.click();
    await expect(submissionsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Position submissions", exact: true })).toHaveCount(0);
    const tableLayout = page.getByRole("tabpanel").locator('[data-slot="admin-table"]');
    const nextPage = tableLayout.getByRole("button", { name: "Next", exact: true });
    await expect(nextPage).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(async () => {
        const countBox = await tableLayout.getByRole("heading", { name: "21 Submissions", exact: true }).boundingBox();
        const nextBox = await nextPage.boundingBox();
        const tableBox = await tableLayout.locator('[data-slot="table-container"]').boundingBox();
        return Boolean(countBox && nextBox && tableBox
          && Math.abs(countBox.y + countBox.height / 2 - nextBox.y - nextBox.height / 2) < 2
          && nextBox.y + nextBox.height <= tableBox.y
          && Math.abs(nextBox.x + nextBox.width - tableBox.x - tableBox.width) < 2);
      }).toBe(true);
    }
    await page.getByRole("row").filter({ hasText: "Design Lead" }).getByRole("button", { name: "View", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Design Lead" });
    await expect(drawer.getByText("UW Tech Club (uwaterloo)")).toBeVisible();
    await drawer.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => reviewed).toBe(true);
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Design Lead" })).toContainText("Approved");
    await expect(submissionsTab.locator('[data-slot="tabs-count"]')).toHaveCount(0);
    await positionsTab.click();
    await expect(page.getByRole("row").filter({ hasText: "Design Lead" })).toHaveCount(0);
  });
});
