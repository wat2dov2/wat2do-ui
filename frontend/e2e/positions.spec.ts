import { expect, test } from "@playwright/test";

const MOCK_POSITION_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const MOCK_POSITIONS = [
  {
    id: 1,
    organization_id: 4,
    title: "Design Lead",
    description: "Lead the visual direction for student campaigns.",
    position_type: "committee",
    requirements: ["Portfolio", "Figma experience"],
    commitment: "3-5 hours per week",
    compensation: "Volunteer",
    location: "Hybrid",
    contact_email: "team@example.com",
    deadline_date: "2026-09-01",
    deadline_at: null,
    source_url: "https://instagram.com/p/design/",
    source_image_url: MOCK_POSITION_IMAGE,
    ingestion_source: "seed",
    is_active: true,
    added_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    organization_name: "UW Design Club",
    organization_logo_url: null,
    organization_ig: "uwdesign",
    school: "uwaterloo",
  },
  {
    id: 2,
    organization_id: 7,
    title: "Operations Assistant",
    description: "Support room bookings and event-day logistics.",
    position_type: "staff",
    requirements: ["Detail oriented"],
    commitment: "6 hours per week",
    compensation: "$20 per hour",
    location: "University of Waterloo",
    contact_email: "operations@example.com",
    deadline_date: "2026-09-05",
    deadline_at: null,
    source_url: "https://instagram.com/p/operations/",
    source_image_url: MOCK_POSITION_IMAGE,
    ingestion_source: "seed",
    is_active: true,
    added_at: "2026-08-02T12:00:00Z",
    updated_at: "2026-08-02T12:00:00Z",
    organization_name: "UW Operations Club",
    organization_logo_url: null,
    organization_ig: "uwoperations",
    school: "uwaterloo",
  },
];

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
  const path = url.pathname.slice("/api".length);
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => apiPath(url) === "/schools",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            slug: "uwaterloo",
            name: "University of Waterloo",
            primary_color: "#000000",
            secondary_color: "#fed34c",
            email_domains: ["uwaterloo.ca"],
          },
        ]),
      });
    },
  );

  await page.route(
    (url) => apiPath(url) === "/auth/refresh",
    async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      });
    },
  );

  await page.route(
    (url) => apiPath(url) === "/positions",
    async (route) => {
      const url = new URL(route.request().url());
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const positionType = url.searchParams.get("position_type");
      const items = MOCK_POSITIONS.filter(
        (position) =>
          (!search ||
            position.title.toLowerCase().includes(search) ||
            position.description.toLowerCase().includes(search)) &&
          (!positionType || position.position_type === positionType),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items,
          total: items.length,
          page: 1,
          page_size: 50,
          total_pages: 1,
        }),
      });
    },
  );
});

test("browses, filters, and searches open organization positions", async ({
  page,
}) => {
  await page.goto("/positions");

  await expect(
    page.getByRole("heading", { name: "2 positions" }),
  ).toBeVisible();
  await expect(page.getByText("Design Lead", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Operations Assistant", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Due Sep 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Committee", { exact: true })).toHaveCount(0);

  await page
    .getByRole("button", { name: "View Design Lead position details" })
    .click();
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

  const organizationLink = drawer.getByRole("link", {
    name: "UW Design Club",
  });
  await expect
    .poll(() =>
      organizationLink.evaluate((link) => {
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
  await page.keyboard.press("Escape");

  await page
    .getByRole("combobox", { name: "Filter positions by type" })
    .click();
  await page.getByRole("option", { name: "Paid staff" }).click();
  await expect(
    page.getByText("Operations Assistant", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Design Lead", { exact: true }),
  ).not.toBeVisible();

  await page
    .getByRole("combobox", { name: "Filter positions by type" })
    .click();
  await page.getByRole("option", { name: "All position types" }).click();
  await page
    .getByPlaceholder("Search roles, skills, or locations...")
    .fill("design");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Design Lead", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Operations Assistant", { exact: true }),
  ).not.toBeVisible();
});
