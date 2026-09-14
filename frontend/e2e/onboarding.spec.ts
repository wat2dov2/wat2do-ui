import { test } from "next/experimental/testmode/playwright.js";
import { expect } from "@playwright/test";
import { mockApi } from "./api-fixture";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://127.0.0.1:3000";
const TEST_EMAIL = "test-onboarding@uwaterloo.ca";

function apiPath(url: URL): string | null {
  if (!url.pathname.startsWith("/api/")) return null;
  return url.pathname.slice("/api".length).replace(/\/$/, "");
}

test.describe("Onboarding Wizard", () => {
  for (const answerQuestions of [true, false]) {
    test(`completes five steps ${answerQuestions ? "with answers" : "without optional answers"}`, async ({ page, next }) => {
      const profileUpdates: unknown[] = [];
      const school = {
        slug: "uwaterloo",
        name: "University of Waterloo",
        language: "en",
        primary_color: "#6b238e",
        secondary_color: "#ffd54f",
        email_domains: ["uwaterloo.ca"],
        faculties: ["Arts", "Engineering", "Mathematics", "Science"],
      };
      const responses: Record<string, unknown> = {
        "/auth/refresh": {
          access_token: "mock-access-token",
          token_type: "bearer",
          expires_in: 3600,
          user_id: "mock-user-id",
        },
        "/meta/constants": {
          event_categories: ["Career", "Technology"],
          club_categories: ["Technology"],
          interests: ["Technology"],
          interest_to_categories: { Technology: ["Technology"] },
          report_statuses: ["pending", "resolved", "dismissed"],
        },
        "/schools": [school],
        "/schools/uwaterloo": school,
        "/users/me": {
          id: "mock-user-id",
          email: TEST_EMAIL,
          school: "uwaterloo",
          faculty: "",
          interests: [],
          is_first_year: false,
          role: "user",
        },
        "/clubs/mine": [],
        "/going-events": [],
        "/saved-clubs": [],
        "/credits": { balance: 0 },
        "/promotions/active-ids": [],
        "/events/stats": {},
        "/events": {
          items: [],
          total: 0,
          page: 1,
          page_size: 50,
          total_pages: 0,
        },
      };
      await mockApi(
        page,
        next,
        (url) => {
          const path = apiPath(url);
          return path !== null && (path === "/users/me/profile" || path in responses);
        },
        async (request) => {
          const path = apiPath(new URL(request.url));
          if (path === "/users/me/profile") {
            expect(request.method).toBe("PATCH");
            profileUpdates.push(await request.json());
            return { json: { status: "success" } };
          }
          return { json: responses[path!] };
        },
      );
      await page.addInitScript(({ keys, email }) => {
        window.localStorage.setItem(keys.USER_EMAIL, JSON.stringify(email));
        window.localStorage.setItem(keys.LANGUAGE, JSON.stringify("en"));
      }, { keys: STORAGE_KEYS, email: TEST_EMAIL });

      await page.goto(`${BASE}/onboarding?school=uwaterloo`);
      await expect.poll(() => page.evaluate((key) => {
        const profile = window.localStorage.getItem(key);
        return profile ? JSON.parse(profile).id : null;
      }, STORAGE_KEYS.USER_PROFILE)).toBe("mock-user-id");

      const progress = page.getByRole("progressbar", { name: /Onboarding step/ });
      const continueButton = page.getByRole("button", { name: "Continue", exact: true });
      await expect(progress).toHaveAttribute("aria-valuemax", "5");

      for (let step = 1; step <= 4; step += 1) {
        await expect(progress).toHaveAttribute("aria-valuenow", String(step));
        if (step === 2) {
          const firstYear = page.getByRole("button", { name: /First Year/i });
          await expect(firstYear).toBeVisible();
          if (answerQuestions) await firstYear.click();
        }
        if (step === 3) {
          const technology = page.getByRole("button", { name: "Technology", exact: true });
          await expect(technology).toBeVisible();
          if (answerQuestions) await technology.click();
        }
        await expect(continueButton).toBeEnabled();
        await continueButton.click();
      }

      await expect(progress).toHaveAttribute("aria-valuenow", "5");
      const faculty = page.getByRole("main").getByRole("combobox").last();
      await expect(faculty).toBeVisible();
      if (answerQuestions) {
        await faculty.click();
        await page.getByRole("option", { name: "Mathematics", exact: true }).click();
      }
      const done = page.getByRole("button", { name: "Take me to Wat2Do!", exact: true });
      await expect(done).toBeEnabled();
      await done.click();

      await expect(page).toHaveURL(`${BASE}/?school=uwaterloo`);
      await expect.poll(() => profileUpdates).toEqual([{
        faculty: answerQuestions ? "Mathematics" : null,
        school: "uwaterloo",
        interests: answerQuestions ? ["Technology"] : [],
        is_first_year: answerQuestions,
      }]);
      const profile = await page.evaluate((key) => {
        return JSON.parse(window.localStorage.getItem(key)!);
      }, STORAGE_KEYS.USER_PROFILE);
      expect(profile).toMatchObject({
        school: "uwaterloo",
        faculty: answerQuestions ? "Mathematics" : "",
        interests: answerQuestions ? ["Technology"] : [],
        isFirstYear: answerQuestions,
      });
    });
  }
});
