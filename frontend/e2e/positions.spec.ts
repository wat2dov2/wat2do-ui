import { expect } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";

const MOCK_POSITION_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const MOCK_POSITIONS = [
  {
    id: 1,
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
    ingestion_source: "seed",
    is_active: true,
    added_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    updated_at: "2026-08-01T12:00:00Z",
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
    ingestion_source: "seed",
    is_active: true,
    added_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updated_at: "2026-08-02T12:00:00Z",
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

test.beforeEach(async ({ page, next }) => {
  await mockApi(page, next,
    (url) => apiPath(url) === "/schools" || apiPath(url) === "/schools/uwaterloo",
    async request => {
      const school = {
            slug: "uwaterloo",
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
  const initialHeaderTop = (await header.boundingBox())!.y;
  await expect(scrollRoot).toHaveCSS("padding-top", "0px");
  await expect(header).toHaveCSS("margin-top", "0px");
  await expect(header).toHaveCSS("padding-top", "16px");
  expect(Math.abs(initialHeaderTop - (await scrollRoot.boundingBox())!.y)).toBeLessThan(2);
  await scrollRoot.evaluate(element => { element.scrollTop = 400; });
  await expect.poll(() => scrollRoot.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  await expect.poll(async () => {
    const headerBox = await header.boundingBox();
    return Math.abs(initialHeaderTop - (headerBox?.y ?? 1000));
  }).toBeLessThan(2);
  await expect(page.getByRole("link", { name: "Add position", exact: true })).toBeVisible();
});

test("filters explicit paid and newly added positions and searches the latest item", async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath("positions-desktop.png"), fullPage: true });
  await page.getByRole("button").filter({ hasText: "Operations Assistant" }).filter({ hasText: "ago" }).click();
  await expect(page.getByPlaceholder("Search roles, skills, or locations...")).toHaveValue("Operations Assistant");
  await expect(page.getByRole("heading", { name: "1 position", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("positions-mobile.png"), fullPage: true });
});

test("navigates position drawers by keyboard and resets scroll for the next role", async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath("position-drawer-mobile.png"), fullPage: true });
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
  await expect(positionCard).toHaveCSS("isolation", "isolate");
  const filterBar = page.getByTestId("position-filter-scroll");
  await expect(filterBar).toHaveCSS("flex-wrap", "nowrap");
  await expect(filterBar).toHaveCSS("overflow-x", "auto");
  const listingHeader = page.locator('[data-slot="page-header"][data-variant="listing"]');
  await expect(listingHeader).toHaveCSS("position", "sticky");
  expect(await listingHeader.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(positionCard.getByText("Committee", { exact: true })).toHaveCount(0);
  const positionFrame = positionCard.locator(
    '[data-slot="event-card-content-frame"]',
  );
  const positionContent = positionFrame.locator(
    '[data-slot="event-card-content"]',
  );
  await expect(positionFrame).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(positionFrame).toHaveCSS("border-top-width", "0px");
  await expect(positionFrame).toHaveCSS("border-right-width", "0px");
  await expect(positionFrame).toHaveCSS("border-bottom-width", "0px");
  await expect(positionFrame).toHaveCSS("border-left-width", "0px");
  await expect(positionContent).toHaveCSS("padding-left", "0px");
  await expect(positionContent).toHaveCSS("padding-right", "0px");
  const clubBadge = positionCard.locator(
    '[data-slot="club-badge"]',
  );
  await expect(clubBadge).toHaveCSS("opacity", "1");
  await positionCard.hover();
  await expect(positionCard).toHaveCSS("opacity", "1");
  await expect(clubBadge).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-slot="card-grid"]')).toHaveCSS(
    "column-gap",
    "20px",
  );
  await expect(
    positionCard.locator(
      '[data-slot="position-card-image"][data-variant="card"]',
    ),
  ).toHaveCSS("border-bottom-right-radius", "12px");

  await positionCard.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveCSS("animation-name", "slideFromBottom");
  await expect(page.locator('[data-slot="drawer-overlay"]')).toHaveCSS(
    "animation-name",
    "fadeIn",
  );
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

  const clubLink = drawer.getByRole("button", {
    name: "UW Design Club",
  }).last();
  await expect
    .poll(() =>
      clubLink.evaluate((link) => {
        const parent = link.parentElement;
        return (
          parent !== null &&
          link.getBoundingClientRect().width < parent.getBoundingClientRect().width
        );
      }),
    )
    .toBe(true);

  const deadlineItem = drawer
    .getByText("Application deadline")
    .locator('xpath=ancestor::*[@data-slot="item"]');
  await expect(deadlineItem).toHaveAttribute("data-variant", "default");
  await expect(deadlineItem).toHaveCSS("flex-direction", "column");
  await expect(deadlineItem).toHaveCSS("align-items", "flex-start");
  await expect(deadlineItem).toHaveCSS("padding-left", "0px");
  await expect(deadlineItem).toHaveCSS("padding-right", "0px");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Paid staff", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Operations Assistant", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Design Lead", exact: true }),
  ).not.toBeVisible();

  await expect(page.getByRole("button", { name: "All position types", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Paid staff", exact: true }).click();
  await expect(page.getByRole("button", { name: "Paid staff", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "2 positions" })).toBeVisible();
  await page
    .getByPlaceholder("Search roles, skills, or locations...")
    .fill("design");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Design Lead", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Operations Assistant", exact: true }),
  ).not.toBeVisible();
});
