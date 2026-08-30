import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE_URL = "http://127.0.0.1:3000";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "33333333-3333-4333-8333-333333333333";
const PENDING_PAYOUT_ID = "44444444-4444-4444-8444-444444444444";
const HELD_PAYOUT_ID = "55555555-5555-4555-8555-555555555555";
const HELD_REVIEW_ID = "66666666-6666-4666-8666-666666666661";
const VOIDED_REVIEW_ID = "66666666-6666-4666-8666-666666666662";
const PAID_REVIEW_ID = "66666666-6666-4666-8666-666666666663";
const CURRENT_TOS_VERSION = "2026-07";

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installCommonApiMocks(page: Page): Promise<void> {
  await page.route(
    (url) => apiPath(url) === "/meta/constants",
    (route) =>
      fulfillJson(route, {
        event_categories: ["Career", "Technology"],
        organization_categories: ["Technology"],
        interests: ["Career", "Technology"],
        interest_to_categories: {
          Career: ["Career"],
          Technology: ["Technology"],
        },
        report_statuses: ["pending", "resolved", "dismissed"],
      }),
  );
  await page.route(
    (url) => apiPath(url) === "/promotions/active-ids",
    (route) => fulfillJson(route, []),
  );
  await page.route(
    (url) => apiPath(url) === "/going-events",
    (route) => fulfillJson(route, []),
  );
  await page.route(
    (url) => apiPath(url) === "/saved-organizations",
    (route) => fulfillJson(route, []),
  );
  await page.route(
    (url) => apiPath(url) === "/credits",
    (route) => fulfillJson(route, { balance: 0 }),
  );
  await page.route(
    (url) => apiPath(url) === "/organizations/mine",
    (route) => fulfillJson(route, []),
  );
  await page.route(
    (url) => apiPath(url) === "/notification-preferences",
    (route) => fulfillJson(route, {}),
  );
  await page.route(
    (url) => apiPath(url) === "/events/stats",
    (route) => fulfillJson(route, {}),
  );
  await page.route(
    (url) => apiPath(url) === "/events",
    (route) => {
      const startsAt = new Date(Date.now() + 86_400_000).toISOString();
      return fulfillJson(route, {
        items: [
          {
            id: 1,
            title: "Campus poster launch",
            description: "Help students discover campus events.",
            location: "Student Life Centre",
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
            category: "Technology",
            organization: "Wat2Do",
            organization_type: "independent",
            school: "uwaterloo",
            added_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
        latest_added_event: null,
      });
    },
  );
}

interface SessionOptions {
  role?: "user" | "admin";
  hasPromoterProfile?: boolean;
  acceptedTermsVersion?: string;
  school?: string | null;
  seedBrowserSession?: boolean;
}

interface SessionMock {
  enrollmentBody: () => unknown;
}

async function installSessionMock(
  page: Page,
  {
    role = "user",
    hasPromoterProfile = false,
    acceptedTermsVersion = CURRENT_TOS_VERSION,
    school = "uwaterloo",
    seedBrowserSession = true,
  }: SessionOptions = {},
): Promise<SessionMock> {
  const now = new Date().toISOString();
  let enrollmentBody: unknown;
  const userId = role === "admin" ? ADMIN_ID : USER_ID;
  const email =
    role === "admin" ? "admin@uwaterloo.ca" : "promoter@uwaterloo.ca";
  const user = {
    id: userId,
    email,
    full_name: role === "admin" ? "Poster Administrator" : "Campus Promoter",
    avatar_url: null,
    faculty: "Mathematics",
    school,
    interests: ["Technology"],
    is_first_year: false,
    role,
    payout_email: hasPromoterProfile ? "payouts@uwaterloo.ca" : null,
    promoter_tos_accepted_at: hasPromoterProfile ? now : null,
    promoter_tos_version: hasPromoterProfile ? acceptedTermsVersion : null,
    created_at: now,
    updated_at: now,
  };

  await page.route(
    (url) => apiPath(url) === "/auth/refresh",
    (route) =>
      fulfillJson(route, {
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        user_id: userId,
        school,
        onboarding_required: false,
      }),
  );
  if (!seedBrowserSession) {
    await page.route(
      (url) => apiPath(url) === "/auth/send-otp",
      (route) => fulfillJson(route, { message: "sent" }),
    );
    await page.route(
      (url) => apiPath(url) === "/auth/verify-otp",
      (route) =>
        fulfillJson(route, {
          access_token: "mock-access-token",
          token_type: "bearer",
          expires_in: 3600,
          user_id: userId,
          school,
          onboarding_required: false,
        }),
    );
  }
  await page.route(
    (url) => apiPath(url) === "/users/me",
    (route) => fulfillJson(route, user),
  );
  await page.route(
    (url) => apiPath(url) === "/users/me/promoter-enrollment",
    async (route) => {
      enrollmentBody = route.request().postDataJSON();
      user.payout_email = String(
        (enrollmentBody as { payout_email: string }).payout_email,
      );
      user.promoter_tos_accepted_at = now;
      user.promoter_tos_version = CURRENT_TOS_VERSION;
      await fulfillJson(route, user);
    },
  );

  const cachedProfile = {
    id: userId,
    fullName: user.full_name,
    avatarUrl: null,
    faculty: user.faculty,
    interests: user.interests,
    isFirstYear: false,
    school: school ?? "",
    role,
    hasOrganization: false,
    clubs: [],
    organizationId: null,
    organizationName: null,
    payoutEmail: user.payout_email,
    promoterTosAcceptedAt: user.promoter_tos_accepted_at,
    promoterTosVersion: user.promoter_tos_version,
  };

  if (seedBrowserSession) {
    await page.addInitScript(
      ({ emailKey, profileKey, cachedEmail, profile }) => {
        window.localStorage.setItem(emailKey, JSON.stringify(cachedEmail));
        window.localStorage.setItem(profileKey, JSON.stringify(profile));
      },
      {
        emailKey: STORAGE_KEYS.USER_EMAIL,
        profileKey: STORAGE_KEYS.USER_PROFILE,
        cachedEmail: email,
        profile: cachedProfile,
      },
    );
  }

  return {
    enrollmentBody: () => enrollmentBody,
  };
}

interface MockPromoterPoster {
  id: string;
  name: string;
  templateId: string;
}

async function installPromoterApiMocks(
  page: Page,
  { programEnabled = true }: { programEnabled?: boolean } = {},
) {
  const posters: MockPromoterPoster[] = [];
  let createBody: unknown;

  await page.route(
    (url) => apiPath(url) === "/qr/map",
    (route) =>
      fulfillJson(route, {
        school: "uwaterloo",
        quiet_after_days: 30,
        cells: [
          {
            latitude: 43.472,
            longitude: -80.545,
            poster_count: 4,
            recent_poster_count: 3,
            quiet_poster_count: 1,
            confirmed_visitor_bucket: "medium",
            owner_name: "PRIVATE PROMOTER NAME",
            poster_id: "PRIVATE-POSTER-ID",
          },
        ],
      }),
  );

  await page.route(
    (url) => apiPath(url) === "/qr/earnings",
    (route) =>
      fulfillJson(route, {
        period: "2026-07",
        posters: posters.map((poster, index) => ({
          qr_code_id: poster.id,
          name: poster.name,
          latest_scan: index === 0 ? new Date().toISOString() : null,
          latitude: index === 0 ? 43.4719 : 0,
          longitude: index === 0 ? -80.5448 : 0,
          poster_template_id: poster.templateId,
          template_preview_url: "/poster-templates/campus-colour-v1.png",
          lifetime_unique_scans: index === 0 ? 8 : 0,
          period_unique_scans: index === 0 ? 6 : 0,
          period_creditable_scans: index === 0 ? 5 : 0,
          pending_cents: index === 0 ? 500 : 0,
        })),
        period_creditable_scans: posters.length > 0 ? 5 : 0,
        period_unqualified_scans: posters.length > 0 ? 1 : 0,
        pending_cents: posters.length > 0 ? 500 : 0,
        lifetime_paid_cents: 500,
        active_slots_used: posters.length,
        active_slots_limit: 50,
        program_enabled: programEnabled,
      }),
  );

  await page.route(
    (url) => apiPath(url) === "/payouts",
    (route) =>
      fulfillJson(route, {
        items: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            period: "2026-06-01",
            payout_email: "payouts@uwaterloo.ca",
            rate_cents: 25,
            amount_cents: 500,
            scan_count: 20,
            status: "paid",
            paid_at: "2026-07-05T12:00:00Z",
            created_at: "2026-07-01T12:00:00Z",
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        total_pages: 1,
      }),
  );

  await page.route(
    (url) => apiPath(url) === "/qr",
    async (route) => {
      if (route.request().method() !== "POST") {
        await fulfillJson(route, {
          items: [],
          total: 0,
          page: 1,
          page_size: 100,
          total_pages: 1,
        });
        return;
      }

      createBody = route.request().postDataJSON();
      const body = createBody as {
        name: string;
        poster_template_id: string;
        copies: number;
      };
      const created = Array.from({ length: body.copies }, (_, index) => {
        const poster: MockPromoterPoster = {
          id: `promoter-poster-${index + 1}`,
          name: `${body.name} ${index + 1}`,
          templateId: body.poster_template_id,
        };
        posters.push(poster);
        return {
          id: poster.id,
          name: poster.name,
          description: null,
          destination_type: "events-list",
          destination_id: null,
          filters: {},
          created_at: new Date().toISOString(),
          created_by: "promoter@uwaterloo.ca",
          is_active: true,
          program: "promoter",
          latest_scan: null,
          poster_template_id: poster.templateId,
          image_url: "/poster-templates/campus-colour-v1.png",
          latitude: 0,
          longitude: 0,
        };
      });
      await fulfillJson(route, { posters: created });
    },
  );

  return {
    createBody: () => createBody,
  };
}

async function installActivationDedupeMocks(page: Page) {
  const posterId = "activation-poster";
  let placed = false;
  let acceptedScans = 0;
  let confirmationAttempts = 0;
  let nextVisitorNumber = 1;
  const confirmedVisitors = new Set<string>();
  const tokenVisitors = new Map<string, string>();
  let placementCoordinates: { latitude: string; longitude: string } | null =
    null;

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: {
              latitude: 43.4723,
              longitude: -80.5449,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          }),
      },
    });
  });

  await page.route(
    (url) => apiPath(url) === `/qr/${posterId}`,
    async (route) => {
      const url = new URL(route.request().url());
      const latitude = url.searchParams.get("lat");
      const longitude = url.searchParams.get("lon");

      if (!placed && (latitude === null || longitude === null)) {
        await fulfillJson(route, { detail: "requires_location" }, 400);
        return;
      }

      if (
        !placed &&
        latitude !== null &&
        longitude !== null &&
        (latitude !== "0" || longitude !== "0")
      ) {
        placed = true;
        placementCoordinates = { latitude, longitude };
      }

      const existingVisitor = route
        .request()
        .headers()
        .cookie?.match(/(?:^|;\s*)wat2do_poster_visitor=([^;]+)/)?.[1];
      const visitor = existingVisitor ?? `visitor-${nextVisitorNumber++}`;
      acceptedScans += 1;
      const confirmationToken = `scan-token-${acceptedScans}`;
      tokenVisitors.set(confirmationToken, visitor);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: existingVisitor
          ? undefined
          : {
              "set-cookie": `wat2do_poster_visitor=${visitor}; Path=/api/qr; HttpOnly; SameSite=Lax`,
            },
        body: JSON.stringify({
          destination_type: "events-list",
          destination_id: null,
          filters: { school: "uwaterloo" },
          query_params: {
            utm_source: "poster",
            poster_id: posterId,
          },
          scan_confirmation_token: confirmationToken,
        }),
      });
    },
  );

  await page.route(
    (url) => apiPath(url) === "/qr/scans/confirm",
    async (route) => {
      confirmationAttempts += 1;
      const token = (route.request().postDataJSON() as { token: string }).token;
      const visitor = tokenVisitors.get(token);
      if (visitor) {
        confirmedVisitors.add(visitor);
      }
      await fulfillJson(route, {
        confirmed: true,
        landing_confirmed_at: new Date().toISOString(),
      });
    },
  );

  await page.route(
    (url) => apiPath(url) === "/qr/earnings",
    (route) =>
      fulfillJson(route, {
        period: "2026-07",
        posters: [
          {
            qr_code_id: posterId,
            name: "Student Life Centre activation poster",
            latest_scan: acceptedScans > 0 ? new Date().toISOString() : null,
            latitude: placed ? 43.4723 : 0,
            longitude: placed ? -80.5449 : 0,
            poster_template_id: "campus-colour",
            template_preview_url: "/poster-templates/campus-colour-v1.png",
            lifetime_unique_scans: confirmedVisitors.size,
            period_unique_scans: confirmedVisitors.size,
            period_creditable_scans: Math.max(0, confirmedVisitors.size - 1),
            pending_cents: Math.max(0, confirmedVisitors.size - 1) * 100,
          },
        ],
        period_creditable_scans: Math.max(0, confirmedVisitors.size - 1),
        period_unqualified_scans: confirmedVisitors.size > 0 ? 1 : 0,
        pending_cents: Math.max(0, confirmedVisitors.size - 1) * 100,
        lifetime_paid_cents: 0,
        active_slots_used: 1,
        active_slots_limit: 50,
        program_enabled: true,
      }),
  );

  await page.route(
    (url) => apiPath(url) === "/qr/map",
    (route) =>
      fulfillJson(route, {
        school: "uwaterloo",
        quiet_after_days: 30,
        cells: [],
      }),
  );
  await page.route(
    (url) => apiPath(url) === "/payouts",
    (route) =>
      fulfillJson(route, {
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        total_pages: 1,
      }),
  );

  return {
    acceptedScans: () => acceptedScans,
    confirmationAttempts: () => confirmationAttempts,
    confirmedUniqueVisitors: () => confirmedVisitors.size,
    placementCoordinates: () => placementCoordinates,
    posterId,
  };
}

test.describe("Promoter poster campaign", () => {
  test("shows only the standard goose while the poster dashboard loads", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, { hasPromoterProfile: true });
    await installPromoterApiMocks(page);

    let releaseEarnings: (() => void) | undefined;
    const earningsPending = new Promise<void>((resolve) => {
      releaseEarnings = resolve;
    });
    await page.route(
      (url) => apiPath(url) === "/qr/earnings",
      async (route) => {
        await earningsPending;
        await route.fallback();
      },
    );

    await page.goto(`${BASE_URL}/posters`);
    await expect.poll(() => releaseEarnings !== undefined).toBe(true);

    const loadingStatus = page.getByRole("status", { name: "Loading..." });
    await expect(loadingStatus).toBeVisible();
    await expect(
      loadingStatus.locator('[data-slot="goose-loading-animation"]'),
    ).toBeVisible();
    await expect(
      page.getByText("Loading your poster dashboard..."),
    ).toHaveCount(0);

    releaseEarnings?.();
    await expect(page.getByTestId("promoter-dashboard")).toBeVisible();
  });

  test("keeps settings tabs content-hugging without narrow-screen overflow", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, { hasPromoterProfile: true });
    await installPromoterApiMocks(page);

    await page.goto(`${BASE_URL}/settings?tab=promoter`);

    const tabs = page.locator('[data-slot="tabs"]');
    const tabsList = page.locator('[data-slot="tabs-list"]');
    const tabTriggers = tabsList.getByRole("tab");
    const promoterTab = page.getByTestId("settings-promoter-tab");
    await expect(tabTriggers).toHaveCount(4);
    await expect(promoterTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Enrolled", { exact: true })).toHaveClass(
      /text-success/,
    );
    await expect(
      page.getByRole("link", { name: "Open my posters" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("promoter-terms-open")).toBeVisible();
    await page.getByTestId("promoter-terms-open").click();
    const acceptedTermsDialog = page.getByTestId("promoter-terms-dialog");
    await expect(
      acceptedTermsDialog.getByTestId("promoter-terms-accept"),
    ).toHaveCount(0);
    await expect(
      acceptedTermsDialog.getByText(
        "Scroll through all terms to enable acceptance.",
      ),
    ).toHaveCount(0);
    const closeTerms = acceptedTermsDialog
      .getByRole("button", { name: "Close" })
      .last();
    await expect(closeTerms).toBeVisible();
    await closeTerms.click();

    await page.evaluate(() => {
      window.history.pushState(null, "", "/settings?tab=profile");
    });
    await expect(
      tabsList.getByRole("tab", { name: "Profile" }),
    ).toHaveAttribute("aria-selected", "true");

    await page.goBack();
    await expect(page).toHaveURL(`${BASE_URL}/settings?tab=promoter`);
    await expect(promoterTab).toHaveAttribute("aria-selected", "true");

    const desktopMetrics = await tabsList.evaluate((list) => {
      const tabsRoot = list.closest<HTMLElement>('[data-slot="tabs"]');
      const lastTab = list.querySelector<HTMLElement>(
        '[role="tab"]:last-of-type',
      );
      if (!tabsRoot || !lastTab) {
        return null;
      }

      const tabsRootBox = tabsRoot.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      const lastTabBox = lastTab.getBoundingClientRect();
      const styles = window.getComputedStyle(list);
      return {
        listWidth: listBox.width,
        rootWidth: tabsRootBox.width,
        trailingSpace: listBox.right - lastTabBox.right,
        paddingRight: Number.parseFloat(styles.paddingRight),
      };
    });
    expect(desktopMetrics).not.toBeNull();
    if (!desktopMetrics) {
      throw new Error("Settings tabs did not render");
    }
    expect(desktopMetrics.listWidth).toBeLessThan(desktopMetrics.rootWidth);
    expect(
      Math.abs(desktopMetrics.trailingSpace - desktopMetrics.paddingRight),
    ).toBeLessThan(1);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect
      .poll(async () =>
        tabsList.evaluate((list) => {
          const parent = list.parentElement;
          return (
            parent !== null &&
            list.scrollWidth <= list.clientWidth &&
            list.getBoundingClientRect().width <=
              parent.getBoundingClientRect().width
          );
        }),
      )
      .toBe(true);

    for (let index = 0; index < 4; index += 1) {
      await expect(tabTriggers.nth(index)).toBeVisible();
    }
    await expect(tabs).toBeVisible();
  });

  test("switches between every standard settings tab", async ({ page }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, { hasPromoterProfile: false });

    await page.goto(`${BASE_URL}/settings`);

    const notificationsTab = page.getByRole("tab", { name: "Notifications" });
    const appearanceTab = page.getByRole("tab", { name: "Appearance" });
    await expect(notificationsTab).toBeEnabled();
    await expect(appearanceTab).toBeEnabled();

    await notificationsTab.click();
    await expect(page).toHaveURL(/\/settings\?tab=notifications$/);
    await expect(page.getByText("Notification Preferences", { exact: true })).toBeVisible();

    await appearanceTab.click();
    await expect(page).toHaveURL(/\/settings\?tab=appearance$/);
    await expect(page.getByText("View Preferences", { exact: true })).toBeVisible();
  });

  test("hides promoter settings from users who are not enrolled", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page);

    await page.goto(`${BASE_URL}/settings?tab=promoter`);

    await expect(page).toHaveURL(`${BASE_URL}/settings?tab=profile`);
    const tabsList = page.locator('[data-slot="tabs-list"]');
    await expect(tabsList.getByRole("tab")).toHaveCount(3);
    await expect(page.getByTestId("settings-promoter-tab")).toHaveCount(0);
    await expect(
      tabsList.getByRole("tab", { name: "Profile" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("recruits, enrolls, and creates independently tracked copies", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    const session = await installSessionMock(page);
    const promoterApi = await installPromoterApiMocks(page);

    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("promoter-recruitment-banner")).toBeVisible();
    await page
      .getByTestId("promoter-recruitment-banner")
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(/\/promote$/);
    await expect(page.getByTestId("promote-page")).toBeVisible();
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Posters", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("promoter-enrollment-form")).toBeVisible();
    await expect(page.getByTestId("poster-map-fallback")).toBeVisible();
    await expect(page.getByText("PRIVATE PROMOTER NAME")).toHaveCount(0);
    await expect(page.getByText("PRIVATE-POSTER-ID")).toHaveCount(0);

    await page
      .getByTestId("promoter-payout-email")
      .fill("payouts@uwaterloo.ca");
    await page.getByTestId("promoter-terms-open").click();
    const termsDialog = page.getByTestId("promoter-terms-dialog");
    const acceptTerms = page.getByTestId("promoter-terms-accept");
    await expect(termsDialog).toContainText("at least 5 seconds");
    await expect(termsDialog).toContainText(/\$1\.00/);
    await expect(termsDialog).toContainText(
      "on the 1st of the following month",
    );
    await expect(acceptTerms).toBeDisabled();
    await page.getByTestId("promoter-terms-body").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(acceptTerms).toBeEnabled();
    await acceptTerms.click();

    await Promise.all([
      page.waitForURL(/\/posters$/),
      page.getByTestId("promoter-enrollment-submit").click(),
    ]);
    expect(session.enrollmentBody()).toEqual({
      payout_email: "payouts@uwaterloo.ca",
      accept_tos: true,
    });

    await expect(page.getByTestId("promoter-dashboard")).toBeVisible();
    await expect(page.getByText("Unqualified scans this month")).toBeVisible();
    const createPosters = page.getByTestId("poster-create-open");
    await expect(createPosters).toBeEnabled();
    await expect(
      page.getByRole("link", {
        name: "Need help? Join the Discord.",
      }),
    ).toHaveAttribute("href", "https://discord.gg/uVcZcp4q8R");
    await createPosters.click();
    await expect(page.getByTestId("poster-template-gallery")).toBeVisible();
    await page
      .getByTestId("poster-template-campus-low-ink")
      .getByRole("button")
      .click();
    await page.getByTestId("poster-copy-count").fill("3");
    await page.getByTestId("poster-create-submit").click();

    await expect
      .poll(() => promoterApi.createBody())
      .toEqual({
        program: "promoter",
        poster_template_id: "campus-low-ink",
        name: "Campus Low Ink",
        copies: 3,
      });
    await expect(page.getByTestId("poster-created-previews")).toBeVisible();

    const pdfDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("poster-batch-download").click();
    await page.getByTestId("poster-batch-download-pdf").click();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toBe("Campus Low Ink.pdf");

    const pngDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("poster-batch-download").click();
    await page.getByTestId("poster-batch-download-png").click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toBe("Campus Low Ink-copy-1.png");
    await expect(page.getByTestId("poster-batch-download")).toBeEnabled({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("poster-inventory")).toBeVisible();
    await expect(
      page.locator('[data-testid^="poster-card-promoter-poster-"]'),
    ).toHaveCount(3);
    await expect(page.getByTestId("payout-history")).toContainText(
      "2026-06-01",
    );
    await expect(page.getByText("PRIVATE PROMOTER NAME")).toHaveCount(0);
  });

  test("keeps the public map aggregated and completes signed-out enrollment inline", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    const session = await installSessionMock(page, {
      seedBrowserSession: false,
    });
    await installPromoterApiMocks(page);

    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("promoter-recruitment-banner")).toBeVisible();
    await page
      .getByTestId("promoter-recruitment-banner")
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(/\/promote$/);
    await expect(page.getByTestId("promote-page")).toBeVisible();
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Posters", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("promoter-enrollment-signed-out"),
    ).toBeVisible();
    await expect(page.getByTestId("poster-map-fallback")).toBeVisible();
    await expect(page.getByText("PRIVATE PROMOTER NAME")).toHaveCount(0);
    await expect(page.getByText("PRIVATE-POSTER-ID")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /private poster/i }),
    ).toHaveCount(0);

    const authForm = page.getByTestId("promoter-enrollment-auth");
    const joinButton = authForm.getByRole("button", {
      name: "Join the program",
      exact: true,
    });
    await expect(joinButton).toBeDisabled();
    await authForm
      .getByLabel("Email address")
      .fill("promoter@uwaterloo.ca");
    await expect(joinButton).toBeEnabled();
    await joinButton.click();

    await expect(authForm.getByLabel("Verification code")).toBeVisible();
    await authForm.getByLabel("Verification code").fill("123456");
    await expect(joinButton).toBeDisabled();

    await page.getByTestId("promoter-terms-open").click();
    await page.getByTestId("promoter-terms-body").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    const acceptTerms = page.getByTestId("promoter-terms-accept");
    await expect(acceptTerms).toBeEnabled();
    await acceptTerms.click();
    await expect(joinButton).toBeEnabled();

    await Promise.all([
      page.waitForURL(/\/posters$/),
      joinButton.click(),
    ]);
    expect(session.enrollmentBody()).toEqual({
      payout_email: "promoter@uwaterloo.ca",
      accept_tos: true,
    });
  });

  test("activates placement and keeps a repeat visitor deduplicated", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, { hasPromoterProfile: true });
    const scanApi = await installActivationDedupeMocks(page);

    await page.goto(`${BASE_URL}/qr/${scanApi.posterId}`);
    await expect(page).toHaveURL(
      new RegExp(`utm_source=poster.*poster_id=${scanApi.posterId}`),
    );
    expect(new URL(page.url()).searchParams.get("school")).toBe("uwaterloo");
    await expect
      .poll(() => scanApi.confirmationAttempts(), { timeout: 10_000 })
      .toBe(1);
    expect(scanApi.placementCoordinates()).toEqual({
      latitude: "43.4723",
      longitude: "-80.5449",
    });

    await page.goto(`${BASE_URL}/qr/${scanApi.posterId}`);
    await expect
      .poll(() => scanApi.confirmationAttempts(), { timeout: 10_000 })
      .toBe(2);
    expect(scanApi.acceptedScans()).toBe(2);
    expect(scanApi.confirmedUniqueVisitors()).toBe(1);

    await page.goto(`${BASE_URL}/posters`);
    let posterCard = page.getByTestId(`poster-card-${scanApi.posterId}`);
    await expect(posterCard).toBeVisible();
    await expect(posterCard).toContainText("$0.00");
    await expect(posterCard).toContainText("1");

    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/qr/${scanApi.posterId}`);
    await expect
      .poll(() => scanApi.confirmationAttempts(), { timeout: 10_000 })
      .toBe(3);
    expect(scanApi.confirmedUniqueVisitors()).toBe(2);

    await page.goto(`${BASE_URL}/posters`);
    posterCard = page.getByTestId(`poster-card-${scanApi.posterId}`);
    await expect(posterCard).toContainText("$1.00");
    await expect(posterCard).toContainText("2");
  });

  test("keeps history readable while the program is paused", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, { hasPromoterProfile: true });
    await installPromoterApiMocks(page, { programEnabled: false });

    await page.goto(`${BASE_URL}/posters`);

    await expect(page.getByTestId("promoter-dashboard")).toBeVisible();
    await expect(page.getByTestId("promoter-program-paused")).toBeVisible();
    await expect(page.getByTestId("poster-create-open")).toHaveCount(0);
    await expect(page.getByTestId("payout-history")).toContainText(
      "2026-06-01",
    );

    await page.goto(`${BASE_URL}/settings?tab=promoter`);
    await expect(page.getByTestId("promoter-terms-open")).toBeVisible();
    await page.getByTestId("promoter-terms-open").click();
    await expect(page.getByTestId("promoter-terms-dialog")).toBeVisible();
  });

  test("keeps enrolled promoter access with earlier acceptance metadata", async ({
    page,
  }) => {
    await installCommonApiMocks(page);
    await installSessionMock(page, {
      hasPromoterProfile: true,
      acceptedTermsVersion: "previous",
    });
    await installPromoterApiMocks(page);

    await page.goto(`${BASE_URL}/posters`);

    await expect(page.getByTestId("promoter-enrollment-form")).toHaveCount(0);
    await expect(page.getByTestId("poster-create-open")).toBeVisible();

    await page.goto(`${BASE_URL}/settings?tab=promoter`);
    await expect(page).toHaveURL(/\/settings\?tab=promoter$/);
    await expect(page.getByTestId("settings-promoter-tab")).toBeVisible();
    await expect(page.getByText("Enrolled", { exact: true })).toBeVisible();
  });
});

type MockPayoutStatus = "pending" | "held" | "paid" | "voided";

interface MockAdminPayout {
  id: string;
  user_id: string;
  period: string;
  payout_email: string;
  rate_cents: number;
  amount_cents: number;
  scan_count: number;
  status: MockPayoutStatus;
  fraud_status: "flagged" | "clear";
  paid_at: string | null;
  notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface MockPayoutReview {
  id: string;
  from_status: MockPayoutStatus;
  to_status: MockPayoutStatus;
  notes: string | null;
  reviewed_by: string;
  reviewed_at: string;
}

async function installAdminPayoutMocks(page: Page) {
  const timestamp = "2026-07-10T12:00:00Z";
  const payouts: MockAdminPayout[] = [
    {
      id: PENDING_PAYOUT_ID,
      user_id: USER_ID,
      period: "2026-06-01",
      payout_email: "ready@uwaterloo.ca",
      rate_cents: 25,
      amount_cents: 2500,
      scan_count: 100,
      status: "pending",
      fraud_status: "clear",
      paid_at: null,
      notes: null,
      reviewed_by: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: HELD_PAYOUT_ID,
      user_id: "77777777-7777-4777-8777-777777777777",
      period: "2026-07-01",
      payout_email: "held@uwaterloo.ca",
      rate_cents: 25,
      amount_cents: 7500,
      scan_count: 300,
      status: "held",
      fraud_status: "flagged",
      paid_at: null,
      notes: "Rapid visitor burst needs review.",
      reviewed_by: REVIEWER_ID,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
  const reviewHistoryByPayoutId: Record<string, MockPayoutReview[]> = {
    [PENDING_PAYOUT_ID]: [],
    [HELD_PAYOUT_ID]: [
      {
        id: HELD_REVIEW_ID,
        from_status: "pending",
        to_status: "held",
        notes: "Rapid visitor burst needs review.",
        reviewed_by: REVIEWER_ID,
        reviewed_at: timestamp,
      },
    ],
  };
  let latestListUrl: URL | null = null;
  let statusUpdateBody: unknown;
  let bulkPaidBody: unknown;
  let exportBody: unknown;

  const applyReviewTransition = (
    payout: MockAdminPayout,
    {
      id,
      status,
      notes,
    }: {
      id: string;
      status: MockPayoutStatus;
      notes: string | null;
    },
  ) => {
    const reviewedAt = new Date().toISOString();
    reviewHistoryByPayoutId[payout.id].push({
      id,
      from_status: payout.status,
      to_status: status,
      notes,
      reviewed_by: REVIEWER_ID,
      reviewed_at: reviewedAt,
    });
    payout.status = status;
    payout.notes = notes;
    payout.reviewed_by = REVIEWER_ID;
    payout.updated_at = reviewedAt;
  };

  await page.route(
    (url) => apiPath(url) === "/payouts/admin",
    (route) => {
      const url = new URL(route.request().url());
      latestListUrl = url;
      const status = url.searchParams.get("payout_status");
      const userId = url.searchParams.get("user_id");
      const email = url.searchParams.get("payout_email");
      const fraudStatus = url.searchParams.get("fraud_status");
      const minAmount = Number(url.searchParams.get("min_amount_cents") ?? 0);
      const maxAmount = Number(
        url.searchParams.get("max_amount_cents") ?? Number.MAX_SAFE_INTEGER,
      );
      const periodFrom = url.searchParams.get("period_from");
      const periodTo = url.searchParams.get("period_to");
      const items = payouts.filter(
        (payout) =>
          (!status || payout.status === status) &&
          (!userId || payout.user_id === userId) &&
          (!email || payout.payout_email.includes(email)) &&
          (!fraudStatus || payout.fraud_status === fraudStatus) &&
          payout.amount_cents >= minAmount &&
          payout.amount_cents <= maxAmount &&
          (!periodFrom || payout.period >= periodFrom) &&
          (!periodTo || payout.period <= periodTo),
      );
      return fulfillJson(route, {
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        total_pages: 1,
      });
    },
  );

  await page.route(
    (url) => {
      const path = apiPath(url);
      return (
        path?.startsWith("/payouts/admin/") === true &&
        !path.endsWith("/status") &&
        path !== "/payouts/admin/export" &&
        path !== "/payouts/admin/mark-paid"
      );
    },
    (route) => {
      const payoutId = (
        apiPath(new URL(route.request().url())) as string
      ).split("/")[3];
      const payout = payouts.find((item) => item.id === payoutId);
      return fulfillJson(route, {
        payout,
        fraud_reasons:
          payout?.fraud_status === "flagged"
            ? [
                {
                  code: "RAPID_DISTINCT_VISITORS",
                  points: 60,
                  affected_scan_count: 22,
                  evidence: {
                    window_seconds: 60,
                    distinct_visitors: 22,
                  },
                },
              ]
            : [],
        contributions: [
          {
            qr_code_id: "promoter-poster-1",
            name: "Student Life Centre",
            poster_template_id: "campus-colour",
            scan_count: payout?.scan_count ?? 0,
            amount_cents: payout?.amount_cents ?? 0,
          },
        ],
        period_start: `${payout?.period}T00:00:00Z`,
        period_end: "2026-08-01T00:00:00Z",
        review_history: payout ? reviewHistoryByPayoutId[payout.id] : [],
      });
    },
  );

  await page.route(
    (url) => apiPath(url)?.endsWith("/status") === true,
    async (route) => {
      statusUpdateBody = route.request().postDataJSON();
      const payoutId = (
        apiPath(new URL(route.request().url())) as string
      ).split("/")[3];
      const payout = payouts.find((item) => item.id === payoutId);
      const update = statusUpdateBody as {
        status: MockPayoutStatus;
        notes: string | null;
      };
      if (payout) {
        applyReviewTransition(payout, {
          id: VOIDED_REVIEW_ID,
          status: update.status,
          notes: update.notes,
        });
        payout.fraud_status =
          update.status === "held" ? "flagged" : payout.fraud_status;
        if (update.status === "paid") {
          payout.paid_at = payout.updated_at;
        }
      }
      await fulfillJson(route, payout);
    },
  );

  await page.route(
    (url) => apiPath(url) === "/payouts/admin/export",
    async (route) => {
      exportBody = route.request().postDataJSON();
      await fulfillJson(route, {
        filename: "wat2do-poster-payouts-2026-07.csv",
        content:
          "recipient_email,amount,scan_count,status,reference\nready@uwaterloo.ca,25.00,100,pending,44444444-4444-4444-8444-444444444444\n",
      });
    },
  );

  await page.route(
    (url) => apiPath(url) === "/payouts/admin/mark-paid",
    async (route) => {
      bulkPaidBody = route.request().postDataJSON();
      const ids = (bulkPaidBody as { payout_ids: string[] }).payout_ids;
      const updated = payouts
        .filter((payout) => ids.includes(payout.id))
        .map((payout) => {
          applyReviewTransition(payout, {
            id: PAID_REVIEW_ID,
            status: "paid",
            notes: null,
          });
          payout.paid_at = payout.updated_at;
          return payout;
        });
      await fulfillJson(route, updated);
    },
  );

  return {
    latestListUrl: () => latestListUrl,
    statusUpdateBody: () => statusUpdateBody,
    bulkPaidBody: () => bulkPaidBody,
    exportBody: () => exportBody,
  };
}

test.describe("Administrator poster payouts", () => {
  test("filters, reviews, exports, and records pending external payments", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-07-28T12:00:00Z"));
    await installCommonApiMocks(page);
    await installSessionMock(page, {
      role: "admin",
      hasPromoterProfile: true,
    });
    const payoutApi = await installAdminPayoutMocks(page);

    await page.goto(`${BASE_URL}/admin/posters`);
    await expect(page.locator('[data-slot="page-back"]')).toContainText(
      "Back to admin dashboard",
    );
    await page.getByTestId("admin-payouts-tab").click();
    await expect(
      page.getByRole("heading", { name: "Poster payouts" }),
    ).toBeVisible();

    await page.locator("#payout-filter-status").click();
    await page.getByRole("option", { name: "Held" }).click();
    await page
      .getByLabel("Promoter ID")
      .fill("77777777-7777-4777-8777-777777777777");
    await page.getByLabel("Payout email").fill("held@uwaterloo.ca");
    await page.locator("#payout-filter-fraud").click();
    await page.getByRole("option", { name: "Flagged" }).click();
    await page.getByLabel("Period from").click();
    await page
      .getByRole("button", { name: "Go to the Previous Month" })
      .click();
    await page
      .locator('[role="gridcell"][data-day="2026-06-01"] button')
      .click();
    await page.getByLabel("Period to").click();
    await page
      .locator('[role="gridcell"][data-day="2026-07-01"] button')
      .click();
    await page.getByLabel("Minimum amount").fill("50");
    await page.getByLabel("Maximum amount").fill("100");
    await page.getByRole("button", { name: "Apply filters" }).click();

    await expect
      .poll(() => payoutApi.latestListUrl()?.searchParams.toString())
      .toContain("payout_status=held");
    const filteredUrl = payoutApi.latestListUrl();
    expect(filteredUrl?.searchParams.get("user_id")).toBe(
      "77777777-7777-4777-8777-777777777777",
    );
    expect(filteredUrl?.searchParams.get("payout_email")).toBe(
      "held@uwaterloo.ca",
    );
    expect(filteredUrl?.searchParams.get("period_from")).toBe("2026-06-01");
    expect(filteredUrl?.searchParams.get("period_to")).toBe("2026-07-01");
    expect(filteredUrl?.searchParams.get("min_amount_cents")).toBe("5000");
    expect(filteredUrl?.searchParams.get("max_amount_cents")).toBe("10000");
    expect(filteredUrl?.searchParams.get("fraud_status")).toBe("flagged");
    await expect(page.getByText("held@uwaterloo.ca")).toBeVisible();

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("ready@uwaterloo.ca")).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "Select payout for held@uwaterloo.ca",
      }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Review" }).nth(1).click();
    const detail = page.getByRole("dialog", { name: "Payout review" });
    await expect(detail.getByText("RAPID_DISTINCT_VISITORS")).toBeVisible();
    await expect(detail.getByText("Student Life Centre")).toBeVisible();
    const reviewHistory = detail.getByTestId("payout-review-history");
    const heldReview = reviewHistory.getByTestId(
      `payout-review-event-${HELD_REVIEW_ID}`,
    );
    await expect(heldReview).toContainText("Payout held");
    await expect(heldReview).toContainText(REVIEWER_ID);
    await expect(heldReview).toContainText("Rapid visitor burst needs review.");
    await detail.getByRole("button", { name: "Void payout" }).click();
    const confirmVoid = detail
      .getByRole("button", { name: "Void payout" })
      .last();
    await expect(confirmVoid).toBeDisabled();
    await detail
      .getByLabel("Review notes")
      .fill("Traffic pattern confirmed as invalid.");
    await confirmVoid.click();
    await expect
      .poll(() => payoutApi.statusUpdateBody())
      .toEqual({
        status: "voided",
        notes: "Traffic pattern confirmed as invalid.",
      });
    const voidedReview = reviewHistory.getByTestId(
      `payout-review-event-${VOIDED_REVIEW_ID}`,
    );
    await expect(voidedReview).toContainText("Payout voided");
    await expect(voidedReview).toContainText(REVIEWER_ID);
    await expect(voidedReview).toContainText(
      "Traffic pattern confirmed as invalid.",
    );
    await expect(reviewHistory.locator("li")).toHaveCount(2);
    await expect(reviewHistory.locator("li").first()).toContainText(
      "Payout held",
    );
    await expect(reviewHistory.locator("li").last()).toContainText(
      "Payout voided",
    );
    await detail.getByRole("button", { name: "Close" }).click();

    const pendingCheckbox = page.getByRole("checkbox", {
      name: "Select payout for ready@uwaterloo.ca",
    });
    await expect(pendingCheckbox).toBeEnabled();
    await pendingCheckbox.click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Interac CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "wat2do-poster-payouts-2026-07.csv",
    );
    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error("Expected the Interac CSV download to have a local path");
    }
    const exportedCsv = await readFile(downloadPath, "utf8");
    expect(exportedCsv).toContain(`pending,${PENDING_PAYOUT_ID}`);
    expect(payoutApi.exportBody()).toEqual({
      payout_ids: [PENDING_PAYOUT_ID],
    });

    await page.getByRole("button", { name: "Mark selected paid" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Record external payments?",
    });
    await expect(confirmation).toContainText(
      "Wat2Do will not send money automatically.",
    );
    await confirmation.getByRole("button", { name: "Record as paid" }).click();
    await expect
      .poll(() => payoutApi.bulkPaidBody())
      .toEqual({
        payout_ids: [PENDING_PAYOUT_ID],
      });
  });
});
