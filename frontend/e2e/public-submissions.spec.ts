import { expect } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

for (const path of ["/events/submit", "/clubs/new", "/positions/submit"]) {
  test(`signed-out visitors can open ${path} and must provide an email`, async ({ page, next }) => {
    await page.addInitScript(key => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
    await mockApi(page, next, url => url.pathname === "/api/auth/refresh", async () => ({ status: 401, json: {} }));
    await mockApi(page, next, url => url.pathname === "/api/ai/parse-event-image", async () => ({ json: {
      title: "Visitor Event", location: "Campus", club_id: 7, category: "Arts & Culture",
      source_image_url: "https://example.com/flyer.png", occurrences: [],
    } }));
    await page.goto(path);
    if (path === "/events/submit") {
      await page.locator('input[type="file"]').setInputFiles({
        name: "flyer.png", mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
      });
    }
    const email = page.getByRole("textbox", { name: "Email address" });
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("required", "");
    expect(await email.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await email.fill("invalid");
    expect(await email.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await email.fill("visitor@example.com");
    expect(await email.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
    await expect(page).toHaveURL(new RegExp(path + "$"));
  });
}


test("an anonymous position submission requires email and returns review confirmation", async ({ page, next }) => {
  await page.addInitScript(key => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
  await mockApi(page, next, url => url.pathname === "/api/auth/refresh", async () => ({ status: 401, json: {} }));
  await page.route("**/api/discovery?**", route => route.fulfill({ json: {
    items: [{ id: 7, club_name: "Visitor Club", club_type: "independent", status: "approved", school: "uwaterloo", ig: "visitorclub", categories: [], club_page: "" }],
    generated_at: 1, total: 1, page: 1, page_size: 1, total_pages: 1,
  } }));
  const submissions: Record<string, unknown>[] = [];
  await mockApi(page, next, url => url.pathname === "/api/position-submissions/", async request => {
    expect(request.headers.get("authorization")).toBeNull();
    const payload = await request.json();
    submissions.push(payload);
    return { status: 201, json: { id: "visitor-submission", status: "pending", ...payload } };
  });
  await page.goto("/positions/submit");
  await page.getByRole("textbox", { name: "Instagram handle" }).fill("visitorclub");
  await page.getByRole("textbox", { name: "Position title" }).fill("Outreach Lead");
  await page.getByRole("textbox", { name: /^Description/ }).fill("Coordinate club outreach.");
  await page.getByRole("textbox", { name: "Source link" }).fill("https://example.com/role");
  await page.getByRole("button", { name: "Submit for Review", exact: true }).click();
  expect(submissions).toHaveLength(0);
  await page.getByRole("textbox", { name: "Email address" }).fill("visitor@example.com");
  await page.getByRole("button", { name: "Submit for Review", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Position submitted for review." })).toHaveText("Position submitted for review.");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ submitted_by_email: "visitor@example.com", position_data: { club_id: 7, title: "Outreach Lead" } });
  expect(submissions[0]).not.toHaveProperty("user_id");
});
