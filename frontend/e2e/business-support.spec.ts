import { expect, test, type Page } from "@playwright/test";
import contactControl from "../../backend/controlbox/contact.json" with { type: "json" };
import {
  BUSINESS_SUPPORT_FIELD_LIMITS,
  buildBusinessSupportMessage,
  type BusinessSupportNomination,
  type ContactMessage,
} from "../src/features/contact/api/contact.api";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const nomination: BusinessSupportNomination = {
  businessName: "  Campus Corner Cafe  ",
  location: "  12 Main Street, Waterloo  ",
  website: "  https://example.com/cafe  ",
  reasonForSupport: "  Road construction has made it hard for students to find them.  ",
  proposedBannerText: "  Your next coffee break can support a local cafe.  ",
  studentTrafficPerWeek: "  Not sure  ",
  email: "  nominator@example.com  ",
};

const school: SchoolSummary = {
  slug: "uwaterloo",
  name: "University of Waterloo",
  city: "Waterloo",
  primary_color: "#ffcb05",
  secondary_color: "#000000",
  timezone: "America/Toronto",
  language: "en",
  faculties: [],
  event_seasons: [],
};

test.describe("message contract", () => {
  test("uses the existing email/message API and includes trimmed nomination plus city", () => {
    const payload = buildBusinessSupportMessage(nomination, school);

    expect(Object.keys(payload).sort()).toEqual(["email", "message"]);
    expect(payload.email).toBe("nominator@example.com");
    expect(payload.message).toContain("Business: Campus Corner Cafe");
    expect(payload.message).toContain("Location or address: 12 Main Street, Waterloo");
    expect(payload.message).toContain("Website or social link: https://example.com/cafe");
    expect(payload.message).toContain("Why support is needed:\nRoad construction");
    expect(payload.message).toContain("Suggested banner text:\nYour next coffee break");
    expect(payload.message).toContain("Estimated student visits per week: Not sure");
    expect(payload.message).toContain("Campus: University of Waterloo (uwaterloo)");
    expect(payload.message).toContain("City: Waterloo");
    expect(payload.message).not.toContain("  ");
  });

  test("omitted website and unavailable city do not invent a location", () => {
    const withoutCity = buildBusinessSupportMessage(
      { ...nomination, website: "   " }, { ...school, city: null },
    );
    expect(withoutCity.message).toContain("Website or social link: Not provided");
    expect(withoutCity.message).toContain("City: Not specified");
    expect(buildBusinessSupportMessage(nomination, undefined).message)
      .toContain("Campus: Not selected");
  });

  test("all form field maxima fit the shared contact message limit", () => {
    const maximumNomination = Object.fromEntries(
      Object.entries(BUSINESS_SUPPORT_FIELD_LIMITS).map(([field, limit]) => [field, "x".repeat(limit)]),
    ) as unknown as BusinessSupportNomination;
    const payload = buildBusinessSupportMessage(maximumNomination, school);
    expect(payload.message.length).toBeLessThanOrEqual(contactControl.maximum_message_length);
  });

  test("oversized final payload fails before the contact API can be called", () => {
    expect(() => buildBusinessSupportMessage({
      ...nomination,
      reasonForSupport: "x".repeat(contactControl.maximum_message_length),
    }, school)).toThrow(RangeError);
  });
});

async function openNomination(page: Page) {
  await page.addInitScript((languageKey) => {
    localStorage.setItem(languageKey, "en");
  }, STORAGE_KEYS.LANGUAGE);
  await page.goto("/support-local");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Support a local business(?: in .+)?$/);
}

async function fillNomination(page: Page) {
  await page.getByLabel("Business name", { exact: true }).fill(nomination.businessName);
  await page.getByLabel("Business location or address", { exact: true }).fill(nomination.location);
  await page.getByLabel("Website or social link (optional)", { exact: true }).fill(nomination.website);
  await page.getByLabel("Why does this business need support?", { exact: true }).fill(nomination.reasonForSupport);
  await page.getByLabel("What should the banner say?", { exact: true }).fill(nomination.proposedBannerText);
  await page.getByLabel("Estimated student visits per week", { exact: true }).fill(nomination.studentTrafficPerWeek);
  await page.getByLabel("Your email address", { exact: true }).fill(nomination.email);
}

test.describe("nomination form", () => {
  test("a signed-out visitor can submit and receives confirmation", async ({ page }) => {
    const submitted: ContactMessage[] = [];
    await page.route(/\/contact\/?(?:\?.*)?$/, async (route) => {
      submitted.push(route.request().postDataJSON() as ContactMessage);
      await route.fulfill({ json: { message: "sent" } });
    });
    await openNomination(page);
    await fillNomination(page);
    await page.getByRole("button", { name: "Send nomination", exact: true }).click();

    await expect(page.getByRole("status")).toContainText("Nomination received");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].email).toBe("nominator@example.com");
    expect(submitted[0].message).toContain("Business: Campus Corner Cafe");
    expect(submitted[0].message).toContain("Estimated student visits per week: Not sure");
    expect(submitted[0].message.length).toBeLessThanOrEqual(contactControl.maximum_message_length);
    await expect(page).toHaveURL(/\/support-local/);

    await page.getByRole("button", { name: "Nominate another business" }).click();
    await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("");
  });

  test("blank answers and invalid links never reach the API", async ({ page }) => {
    let requestCount = 0;
    await page.route(/\/contact\/?(?:\?.*)?$/, async (route) => {
      requestCount += 1;
      await route.fulfill({ json: { message: "sent" } });
    });
    await openNomination(page);
    await fillNomination(page);
    await page.getByLabel("Business name", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Send nomination", exact: true }).click();
    await expect(page.getByLabel("Business name", { exact: true })).toBeFocused();
    await expect(page.getByText("Please fill in this field.", { exact: true })).toBeVisible();
    expect(requestCount).toBe(0);

    await page.getByLabel("Business name", { exact: true }).fill("Campus Corner Cafe");
    await page.getByLabel("Website or social link (optional)", { exact: true }).fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Send nomination", exact: true }).click();
    await expect(page.getByText("Enter a valid http:// or https:// link.", { exact: true })).toBeVisible();
    expect(requestCount).toBe(0);
  });

  test("failed submission preserves all answers for retry", async ({ page }) => {
    let requestCount = 0;
    await page.route(/\/contact\/?(?:\?.*)?$/, async (route) => {
      requestCount += 1;
      await route.fulfill(requestCount === 1
        ? { status: 503, json: { detail: "Please try again shortly." } }
        : { json: { message: "sent" } });
    });
    await openNomination(page);
    await fillNomination(page);
    await page.getByRole("button", { name: "Send nomination", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Please try again shortly.");
    await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(nomination.businessName);
    await expect(page.getByLabel("Why does this business need support?", { exact: true }))
      .toHaveValue(nomination.reasonForSupport);
    await page.getByRole("button", { name: "Send nomination", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Nomination received");
    expect(requestCount).toBe(2);
  });

  test("an in-flight submission cannot send the nomination twice", async ({ page }) => {
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => { release = resolve; });
    let requestCount = 0;
    await page.route(/\/contact\/?(?:\?.*)?$/, async (route) => {
      requestCount += 1;
      await responseReady;
      await route.fulfill({ json: { message: "sent" } });
    });
    try {
      await openNomination(page);
      await fillNomination(page);
      await page.getByRole("button", { name: "Send nomination", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sending nomination...", exact: true })).toBeDisabled();
      await page.locator("form").dispatchEvent("submit");
      await expect.poll(() => requestCount).toBe(1);
      release();
      await expect(page.getByRole("status")).toContainText("Nomination received");
      expect(requestCount).toBe(1);
    } finally {
      release();
    }
  });
});
