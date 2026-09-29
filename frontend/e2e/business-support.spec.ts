import { expect, test, type Page } from "@playwright/test";
import type { ContactMessage } from "../src/features/contact/api/contact.api";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";
import { nomination } from "./business-support-fixture";

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
