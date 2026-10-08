import { expect } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";

const MOCK_POSITION_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const MOCK_POSITIONS = [
  {
    id: 1,
    cohosts: [{ id: 7, club_name: "UW Operations Club", logo_url: null, ig: "uwoperations" }],
    club_id: 4,
    title: "Design Lead",
    description: "Lead the visual direction for student campaigns.",
    position_type: "committee",
    requirements: ["Portfolio", "Figma experience"],
    commitment: "3-5 hours per week",
    compensation: "Volunteer",
    is_paid: false,
    location: "Hybrid",
    contact_email: "team@example.com",
    deadline_date: "2026-09-01",
    deadline_at: null,
    source_url: "https://instagram.com/p/design/",
    source_image_url: MOCK_POSITION_IMAGE,
    is_active: true,
    added_at: "2026-08-01T12:00:00Z",
    club_name: "UW Design Club",
    club_logo_url: null,
    club_ig: "uwdesign",
    school: "uwaterloo",
  },
  {
    id: 2,
    club_id: 7,
    title: "Operations Assistant",
    description: "Support room bookings and event-day logistics.",
    position_type: "staff",
    requirements: ["Detail oriented"],
    commitment: "6 hours per week",
    compensation: "$20 per hour",
    is_paid: true,
    location: "University of Waterloo",
    contact_email: "operations@example.com",
    deadline_date: "2026-09-05",
    deadline_at: null,
    source_url: "https://instagram.com/p/operations/",
    source_image_url: MOCK_POSITION_IMAGE,
    is_active: true,
    added_at: "2026-08-02T12:00:00Z",
    club_name: "UW Operations Club",
    club_logo_url: null,
    club_ig: "uwoperations",
    school: "uwaterloo",
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

test.describe("Positions UI", () => {
  test.beforeEach(async ({ page, next }) => {
    await mockApi(page, next, url => apiPath(url) === "/discovery-queries", async () => ({ status: 204 }));
    await page.clock.setFixedTime(new Date("2026-08-02T18:00:00Z"));
    await mockApi(page, next,
      (url) => apiPath(url) === "/schools" || apiPath(url) === "/schools/uwaterloo",
      async request => {
        const school = {
              slug: "uwaterloo", timezone: "America/Toronto",
              name: "University of Waterloo",
              primary_color: "#000000",
              secondary_color: "#fed34c",
              email_domains: ["uwaterloo.ca"],
              language: "en", faculties: ["Mathematics", "Engineering"],
        };
        return { json: apiPath(new URL(request.url)) === "/schools" ? [school] : school };
      },
    );

    await mockApi(page, next,
      (url) => apiPath(url) === "/auth/refresh",
      async () => {
        return ({
          status: 401,
          contentType: "application/json",
          body: "{}",
        });
      },
    );

    await mockApi(page, next,
      (url) => apiPath(url) === "/positions",
      async request => {
        const url = new URL(request.url);
        const search = url.searchParams.get("search")?.toLowerCase() ?? "";
        const positionType = url.searchParams.get("position_type");
        const paidOnly = url.searchParams.get("paid_only") === "true";
        const addedSince = url.searchParams.get("added_since");
        const items = MOCK_POSITIONS.filter(
          (position) =>
            (!search ||
              position.title.toLowerCase().includes(search) ||
              position.description.toLowerCase().includes(search)) &&
            (!positionType || position.position_type === positionType) &&
            (!paidOnly || position.is_paid === true) &&
            (!addedSince || position.added_at >= addedSince),
        );
        return ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items,
            total: items.length,
            page: 1,
            page_size: 50,
            total_pages: 1,
            latest_added_position: { title: MOCK_POSITIONS[1].title, added_at: MOCK_POSITIONS[1].added_at },
          }),
        });
      },
    );
  });

  test("shows a New badge only on recently added position cards", async ({ page }) => {
    await page.goto("/positions");
    const recent = page.getByRole("button", { name: "View Operations Assistant position details", exact: true });
    const older = page.getByRole("button", { name: "View Design Lead position details", exact: true });
    await expect(recent.getByText("New", { exact: true })).toBeVisible();
    await expect(older.getByText("New", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Paid", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Paid staff", exact: true })).toHaveCount(0);
  });

  test("logs positions and filters despite a failed background write", async ({ page }) => {
    const captured: Array<{ id: string; school: string; surface: string; search_query: string; page_url: string; filters: Record<string, unknown> }> = [];
    await page.route("**/api/discovery-queries/", async route => {
      captured.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, json: { detail: "Telemetry unavailable" } });
    });
    await page.goto("/positions");
    await page.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Operations Assistant", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Design Lead", exact: true })).toHaveCount(0);
    await expect.poll(() => captured.some(row => row.filters.positionType === "staff")).toBe(true);
    const search = page.getByPlaceholder("Search roles, skills, or locations...");
    await search.fill("Operations");
    await search.press("Enter");
    await expect.poll(() => captured.some(row => row.search_query === "Operations")).toBe(true);
    const submitted = captured.find(row => row.search_query === "Operations")!;
    expect(submitted).toMatchObject({ school: "uwaterloo", surface: "positions", filters: { positionType: "staff" } });
    expect(submitted.page_url).toContain("/positions");
    await expect.poll(() => captured.filter(row => row.id === submitted.id).length).toBeGreaterThan(1);
    await expect(page.getByRole("heading", { name: "Operations Assistant", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("keeps the listing controls fixed while scrolling on mobile", async ({ page, next }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, next, url => apiPath(url) === "/positions", async () => {
      const items = Array.from({ length: 30 }, (_, index) => ({ ...MOCK_POSITIONS[index % 2], id: index + 1 }));
      return { json: { items, total: items.length, page: 1, page_size: 30, total_pages: 1 } };
    });
    await page.goto("/positions");
    await expect(page.getByRole("heading", { name: "30 positions", exact: true })).toBeVisible();
    const scrollRoot = page.locator('[data-slot="page-frame"]');
    const header = page.locator('[data-slot="page-header"]');
    await expect(scrollRoot).toHaveCSS("overscroll-behavior-y", "none");
    const initialHeaderTop = (await header.boundingBox())!.y;
    expect(Math.abs(initialHeaderTop - (await scrollRoot.boundingBox())!.y)).toBeLessThan(2);
    await scrollRoot.evaluate(element => { element.scrollTop = 400; });
    await expect.poll(() => scrollRoot.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
    await expect.poll(async () => {
      const headerBox = await header.boundingBox();
      return Math.abs(initialHeaderTop - (headerBox?.y ?? 1000));
    }).toBeLessThan(2);
    await expect(page.getByRole("link", { name: "Add position", exact: true })).toBeVisible();
    const committee = page.getByTestId("position-filter-scroll").getByRole("button", { name: "Committee", exact: true });
    await committee.click();
    await expect(committee).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => scrollRoot.evaluate(element => element.scrollTop)).toBe(0);

  });

  test("filters explicit paid and newly added positions and searches the latest item", async ({ page }) => {
    await page.goto("/positions");
    const paid = page.getByRole("button", { name: "Paid", exact: true });
    const newFilter = page.getByRole("button", { name: "New", exact: true });
    await paid.click();
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operations Assistant", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Design Lead", exact: true })).toHaveCount(0);
    await paid.click();
    await newFilter.click();
    await page.getByRole("dialog").getByRole("button", { name: "New", exact: true }).click();
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
    await newFilter.click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear newly added filter" }).click();
    await expect(page.getByRole("heading", { name: "2 positions", exact: true })).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Operations Assistant" }).filter({ hasText: "ago" }).click();
    await expect(page.getByPlaceholder("Search roles, skills, or locations...")).toHaveValue("Operations Assistant");
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("keeps the latest-added link visible while cached search returns no results", async ({ page }) => {
    await page.goto("/positions");
    const latest = page.getByRole("button").filter({ hasText: "Operations Assistant" }).filter({ hasText: "ago" });
    await expect(latest).toBeVisible();
    const filterRequests: string[] = [];
    page.on("request", request => {
      if (apiPath(new URL(request.url())) === "/positions") filterRequests.push(request.url());
    });
    await page.getByPlaceholder("Search roles, skills, or locations...").fill("no matching role");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "0 positions", exact: true })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(latest).toBeVisible();
    await latest.click();
    await expect(page.getByPlaceholder("Search roles, skills, or locations...")).toHaveValue("Operations Assistant");
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
    expect(filterRequests).toEqual([]);
  });

  test("shared club badges overlap logos and keep the extra-club count visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/positions");
    const card = page.getByRole("button", { name: "View Design Lead position details" });
    const badge = card.locator('[data-slot="club-badge"]');
    await expect(badge.locator('[data-slot="avatar-stack"] > div')).toHaveCount(2);
    const count = badge.locator('[data-slot="club-cohost-count"]');
    await expect(count).toHaveText("+1");
    const badgeBox = (await badge.boundingBox())!;
    const countBox = (await count.boundingBox())!;
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(badgeBox.x + badgeBox.width);
    await badge.click();
    await expect(page.getByRole("menuitem", { name: /UW Operations Club/ })).toBeVisible();
  });

  test("keeps filters click-based and navigates more positions on mouse down", async ({ page }) => {
    await page.goto("/positions");
    const paid = page.getByRole("button", { name: "Paid", exact: true });
    await paid.hover();
    await page.mouse.down();
    await expect(paid).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("heading", { name: "2 positions", exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(paid).toHaveAttribute("aria-pressed", "true");
    await paid.click();

    await page.getByRole("button", { name: "View Design Lead position details" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "More positions", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "View Design Lead position details" })).toHaveCount(0);
    await drawer.getByRole("button", { name: "View Operations Assistant position details" }).click();
    await expect(drawer.getByRole("heading", { name: "Operations Assistant", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "View Design Lead position details" })).toBeVisible();

    await drawer.getByRole("button", { name: "Previous", exact: true }).hover();
    await page.mouse.down();
    await expect(drawer.getByRole("heading", { name: "Design Lead", exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(drawer.getByRole("heading", { name: "Design Lead", exact: true })).toBeVisible();
  });

  test("changes position type from the cached directory without loading or requests", async ({ page }) => {
    await page.goto("/positions");
    await expect(page.getByRole("button", { name: "View Design Lead position details" })).toBeVisible();
    const filterRequests: string[] = [];
    page.on("request", request => {
      if (apiPath(new URL(request.url())) === "/positions") filterRequests.push(request.url());
    });
    await page.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(page.getByRole("button", { name: "View Operations Assistant position details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Design Lead position details" })).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
    expect(filterRequests).toEqual([]);
  });

  test("retries a failed initial directory request and resumes local filtering", async ({ page, next }) => {
    let failed = true;
    await mockApi(page, next, url => apiPath(url) === "/positions", async () => {
      if (failed) return { status: 503, json: { detail: "Temporarily unavailable" } };
      return { json: {
        items: MOCK_POSITIONS, total: 2, page: 1, page_size: 50, total_pages: 1,
        latest_added_position: { title: MOCK_POSITIONS[1].title, added_at: MOCK_POSITIONS[1].added_at },
      } };
    });
    await page.goto("/positions");
    const error = page.getByRole("alert");
    await expect(error).toContainText("Something went wrong");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    failed = false;
    await error.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "2 positions", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Committee", exact: true }).click();
    await expect(page.getByRole("button", { name: "View Design Lead position details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
  });

  test("navigates position drawers by keyboard and resets scroll for the next role", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/positions");
    await page.getByRole("button", { name: "View Design Lead position details" }).click();
    const drawer = page.getByRole("dialog");
    const body = drawer.locator('[data-slot="drawer-body"]');
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.keyboard.press("ArrowRight");
    await expect(drawer.getByRole("heading", { name: "Operations Assistant" })).toBeVisible();
    await expect.poll(() => drawer.locator('[data-slot="drawer-body"]').evaluate(element => element.scrollTop)).toBe(0);
    await expect(drawer.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await drawer.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(drawer.getByRole("heading", { name: "Design Lead" })).toBeVisible();
  });

  test("browses, filters, and searches open club positions", async ({
    page,
  }) => {
    await page.goto("/positions");

    await expect(
      page.getByRole("heading", { name: "2 positions" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Design Lead", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Operations Assistant", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Due Sep 1", { exact: true })).toBeVisible();
    const positionCard = page.getByRole("button", {
      name: "View Design Lead position details",
    });
    await positionCard.click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByRole("heading", { name: "Design Lead" }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("heading", { name: "Requirements" }),
    ).toBeVisible();
    await expect(drawer.getByText("Committee", { exact: true })).toBeVisible();
    const detailGrid = drawer.locator('[data-slot="form-grid"]').first();
    const detailColumns = detailGrid.locator(":scope > *");
    await expect
      .poll(async () => {
        const imageBox = await detailColumns.nth(0).boundingBox();
        const contentBox = await detailColumns.nth(1).boundingBox();
        return imageBox !== null && contentBox !== null && imageBox.x < contentBox.x;
      })
      .toBe(true);

    await expect(drawer.getByText("Application deadline")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Operations Assistant", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Design Lead", exact: true }),
    ).not.toBeVisible();

    await expect(page.getByRole("button", { name: "All position types", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(page.getByRole("button", { name: "Paid", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("heading", { name: "2 positions" })).toBeVisible();
    await page
      .getByPlaceholder("Search roles, skills, or locations...")
      .fill("design");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Design Lead", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Operations Assistant", exact: true }),
    ).not.toBeVisible();
    expect(filterRequests).toEqual([]);
  });
});
