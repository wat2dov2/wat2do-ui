import { expect } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

for (const path of ["/events/submit", "/positions/submit"]) {
  test(`signed-out visitors can open ${path} with a required email`, async ({ page, next }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(key => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
    await mockApi(page, next, url => url.pathname === "/api/auth/refresh", async () => ({ status: 401, json: {} }));
    await mockApi(page, next, url => url.pathname === "/api/ai/parse-event-image", async () => ({ json: {
      title: "Visitor Event", location: "Campus", club_id: 7, category: "Arts & Culture",
      source_image_url: "https://example.com/flyer.png", occurrences: [],
    } }));
    await page.goto(path);
    if (path === "/positions/submit") {
      await page.getByRole("button", { name: "Skip and fill in manually" }).click();
    }
    if (path === "/events/submit") {
      // Events always start from a flyer, so only positions offer a skip.
      await expect(page.getByRole("button", { name: "Skip and fill in manually" })).toHaveCount(0);
      await page.locator('input[type="file"]').setInputFiles({
        name: "flyer.png", mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
      });
    }
    const email = page.getByRole("textbox", { name: "Email address" });
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("required", "");
    // Check actual mobile geometry after parsing, including nested field groups.
    // Email and title used to touch because the spacing owner wrapped the form.
    const layout = await page.locator("form").filter({ has: email }).evaluate(form => {
      const controls = [...form.querySelectorAll<HTMLElement>(
        '[data-slot="field"] > input, [data-slot="field"] > textarea, [data-slot="field"] > button',
      )].filter(control => control.getBoundingClientRect().height > 0);
      const fields = controls.map(control => control.parentElement!.getBoundingClientRect());
      return {
        overflowing: controls.some(control => {
          const bounds = control.getBoundingClientRect();
          return bounds.left < 0 || bounds.right > window.innerWidth;
        }),
        gaps: fields.slice(1).map((field, index) => field.top - fields[index].bottom),
      };
    });
    expect(layout.overflowing).toBe(false);
    // Section headings, images, and helper text may create larger gaps.
    // Every consecutive field must still have the shared 20px minimum rhythm.
    for (const gap of layout.gaps) expect(gap).toBeGreaterThanOrEqual(19);

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
  await page.getByRole("button", { name: "Skip and fill in manually" }).click();
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

test("a position poster prefills the form and is submitted with the position", async ({ page, next }) => {
  await page.addInitScript(key => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
  await mockApi(page, next, url => url.pathname === "/api/auth/refresh", async () => ({ status: 401, json: {} }));
  await page.route("**/api/discovery?**", route => route.fulfill({ json: {
    items: [{ id: 7, club_name: "Visitor Club", club_type: "independent", status: "approved", school: "uwaterloo", ig: "visitorclub", categories: [], club_page: "" }],
    generated_at: 1, total: 1, page: 1, page_size: 1, total_pages: 1,
  } }));
  await mockApi(page, next, url => url.pathname === "/api/ai/parse-position-image", async () => ({ json: {
    title: "Outreach Lead", description: "Coordinate club outreach.", position_type: "committee", requirements: [],
    source_image_url: "https://example.com/poster.png",
  } }));
  const submissions: Record<string, unknown>[] = [];
  await mockApi(page, next, url => url.pathname === "/api/position-submissions/", async request => {
    const payload = await request.json();
    submissions.push(payload);
    return { status: 201, json: { id: "poster-submission", status: "pending", ...payload } };
  });
  await page.goto("/positions/submit");
  await expect(page.getByRole("heading", { name: "Upload Position Poster" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "poster.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByRole("textbox", { name: "Position title" })).toHaveValue("Outreach Lead");
  await page.getByRole("textbox", { name: "Instagram handle" }).fill("visitorclub");
  await page.getByRole("textbox", { name: "Source link" }).fill("https://example.com/role");
  await page.getByRole("textbox", { name: "Email address" }).fill("visitor@example.com");
  await page.getByRole("button", { name: "Submit for Review", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Position submitted for review." })).toBeVisible();
  expect(submissions[0]).toMatchObject({ position_data: { club_id: 7, title: "Outreach Lead", source_image_url: "https://example.com/poster.png" } });
});

test("a signed-out visitor fills in a club, then signs in over the form to send it", async ({ page, next }) => {
  await page.addInitScript(key => localStorage.setItem(key, "en"), STORAGE_KEYS.LANGUAGE);
  await mockApi(page, next, url => url.pathname === "/api/auth/refresh", async () => ({ status: 401, json: {} }));
  await mockApi(page, next, url => url.pathname === "/api/auth/send-otp", async () => ({ json: { message: "sent" } }));
  await mockApi(page, next, url => url.pathname === "/api/auth/verify-otp", async () => ({ json: {
    access_token: "visitor-token", token_type: "bearer", expires_in: 3600,
    user_id: "visitor-user", school: "uwaterloo", onboarding_required: true,
  } }));
  await mockApi(page, next, url => url.pathname === "/api/users/me", async () => ({ json: {
    id: "visitor-user", email: "visitor@uwaterloo.ca", full_name: null, avatar_url: null, faculty: null,
    school: "uwaterloo", interests: [], is_first_year: false, role: "user",
    payout_email: null, promoter_tos_accepted_at: null, promoter_tos_version: null,
  } }));
  await mockApi(page, next, url => url.pathname === "/api/clubs/mine", async () => ({ json: [] }));
  const created: Record<string, unknown>[] = [];
  await mockApi(page, next, url => url.pathname === "/api/clubs/", async request => {
    expect(request.headers.get("authorization")).toBe("Bearer visitor-token");
    const payload = await request.json();
    created.push(payload);
    return { status: 201, json: { id: 9, status: "pending", created_by: "visitor-user", created_at: new Date().toISOString(), position_count: 0, ...payload } };
  });

  await page.goto("/clubs/new");
  // The form is open to everyone, with no email of its own to type.
  await expect(page.getByRole("textbox", { name: "Email address" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Club Name" }).fill("Visitor Club");
  await page.getByRole("button", { name: "Arts & Culture" }).click();
  await page.getByRole("button", { name: "Add club", exact: true }).click();

  // Sending it asks for sign-in over the form, which keeps what was typed.
  const signIn = page.getByRole("dialog");
  await signIn.getByRole("textbox", { name: "Email address" }).fill("visitor@uwaterloo.ca");
  await signIn.getByRole("button", { name: "Continue", exact: true }).click();
  await signIn.getByRole("textbox", { name: "Verification code", exact: true }).fill("123456");

  await expect(signIn).toHaveCount(0);
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({ club_name: "Visitor Club", categories: ["Arts & Culture"], submitted_by_email: "visitor@uwaterloo.ca" });
});
