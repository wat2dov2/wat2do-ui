import { test, expect } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://localhost:5173";
const API = "http://localhost:8000";
const TEST_EMAIL = "test-onboarding@uwaterloo.ca";

async function seedAuthenticatedSession(page: Parameters<typeof test>[0]["page"]) {
  await page.addInitScript(({ key, email }) => {
    window.localStorage.setItem(key, JSON.stringify(email));
  }, { key: STORAGE_KEYS.USER_EMAIL, email: TEST_EMAIL });
}

test.describe("Onboarding Wizard E2E Flow", () => {
  test("guides user through all 6 steps and updates profile on completion", async ({ page }) => {
    // Print console logs from the browser
    page.on("console", (msg) => {
      console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`);
    });

    page.on("pageerror", (err) => {
      console.log(`BROWSER ERROR: ${err.message}`);
    });

    // Set up API mocks before navigation, targeting only the backend port (8000)
    await page.route(`${API}/auth/refresh`, async (route) => {
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

    await page.route(`${API}/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mock-user-id",
          email: TEST_EMAIL,
          school: "University of Waterloo",
          faculty: "",
          interests: [],
          is_first_year: false,
          role: "user",
        }),
      });
    });

    await page.route(`${API}/clubs/mine`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(`${API}/users/me/profile`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "success" }),
      });
    });

    await page.route(`${API}/events*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            title: "Mock Event 1",
            location: "MC 2012",
            price: 0,
            food: "Pizza",
            registration: false,
            category: "Technology",
            organization: "Tech Club",
            school: "University of Waterloo",
            added_at: new Date().toISOString(),
            status: "CONFIRMED",
          },
        ]),
      });
    });

    await page.route(`${API}/promotions/active-ids`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // 1. Seed session and go to onboarding page
    await seedAuthenticatedSession(page);
    await page.goto(`${BASE}/onboarding`);
    await page.waitForTimeout(2000);

    // Verify step 0 (Welcome) goose dialogue is visible
    await expect(page.getByText("Mr. Goose")).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toBeEnabled();
    
    // Proceed to Step 1
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(500);

    // Step 1: First Year selection step (our new component!)
    const firstYearBtn = page.getByRole("button", { name: /First Year/i });
    const returningBtn = page.getByRole("button", { name: /Returning Student/i });
    await expect(firstYearBtn).toBeVisible();
    await expect(returningBtn).toBeVisible();

    // Click "First Year" option
    await firstYearBtn.click();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(500);

    // Step 2: Interests selection
    await expect(page.getByPlaceholder(/search or select/i)).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(500);

    // Step 3: Event selection grid
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(500);

    // Step 4: Faculty selection step
    const selectTrigger = page.getByRole("combobox").nth(1);
    await expect(selectTrigger).toBeVisible();
    await selectTrigger.click();
    
    // Choose Mathematics faculty
    const mathOption = page.getByRole("option", { name: /mathematics/i }).first();
    await expect(mathOption).toBeVisible();
    await mathOption.click();

    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(500);

    // Step 5: Email subscription step
    const doneBtn = page.getByRole("button", { name: /Take me to Wat2Do!/i });
    await expect(doneBtn).toBeVisible();
    await doneBtn.click();
    await page.waitForTimeout(1000);

    // 2. Verifications: redirect and profile sync
    await expect(page).toHaveURL(`${BASE}/`);

    // Verify local storage profile structure matches what we set
    const profileString = await page.evaluate(() => window.localStorage.getItem("userProfile"));
    expect(profileString).toBeTruthy();
    
    const profile = JSON.parse(profileString!);
    expect(profile.isFirstYear).toBe(true);
    expect(profile.faculty).toBe("Mathematics");
  });
});
