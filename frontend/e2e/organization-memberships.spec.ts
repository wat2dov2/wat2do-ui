import { test, expect, type Page } from "@playwright/test";
import { STORAGE_KEYS } from "../src/shared/constants/storageKeys";

const BASE = "http://localhost:5173";
const API = "http://localhost:8000";
const STUDENT_EMAIL = "student@uwaterloo.ca";
const OWNER_EMAIL = "owner@uwaterloo.ca";

const MOCK_CLUB = {
  id: 1,
  club_name: "UW Computer Science Club",
  categories: ["Technology", "Academic"],
  club_page: "https://csclub.uwaterloo.ca",
  ig: "uwcsc",
  discord: "https://discord.gg/csc",
  club_type: "WUSA",
  logo_url: null,
  created_by: "owner-user-id",
  school: "University of Waterloo",
};

// Seed session helper
async function seedSession(page: Page, email: string, clubId: number | null = null) {
  await page.addInitScript(
    ({ key, emailValue, profileKey, clubIdVal }) => {
      window.localStorage.setItem(key, JSON.stringify(emailValue));
      window.localStorage.setItem(
        profileKey,
        JSON.stringify({
          id: emailValue === "owner@uwaterloo.ca" ? "owner-user-id" : "student-user-id",
          email: emailValue,
          school: "University of Waterloo",
          faculty: "Mathematics",
          interests: ["AI"],
          isFirstYear: false,
          role: "user",
          hasClub: clubIdVal !== null,
          clubs: clubIdVal !== null ? [{ id: clubIdVal, club_name: "UW Computer Science Club" }] : [],
          clubId: clubIdVal,
          clubName: clubIdVal !== null ? "UW Computer Science Club" : null,
        })
      );
    },
    {
      key: STORAGE_KEYS.USER_EMAIL,
      emailValue: email,
      profileKey: STORAGE_KEYS.USER_PROFILE,
      clubIdVal: clubId,
    }
  );
}

test.describe("Organization Membership Join & Admin Approval Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Debug logging
    page.on("console", (msg) => {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
    page.on("request", (req) => {
      console.log(`[BROWSER REQUEST] ${req.method()} ${req.url()}`);
    });
    page.on("requestfailed", (req) => {
      console.log(`[BROWSER REQUEST FAILED] ${req.url()} - ${req.failure()?.errorText}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        console.log(`[BROWSER RESPONSE ERROR] ${res.status()} ${res.url()}`);
      }
    });

    // Mock credits balance
    await page.route(url => url.pathname === "/credits/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: 100 }),
      });
    });

    // Mock saved events list
    await page.route(url => url.pathname === "/saved-events/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock active promotions
    await page.route(url => url.pathname === "/promotions/active-ids", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock general events list
    await page.route(url => url.pathname === "/events/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock user clubs list (default empty for students)
    await page.route(url => url.pathname === "/clubs/mine", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock posters list (default empty)
    await page.route(url => url.pathname === "/qr/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          page: 1,
          total_pages: 1,
        }),
      });
    });
  });

  // --- Test 1: Student requests to join a club ---
  test("User can request to join an organization, and cancel the request", async ({ page }) => {
    // Mock general APIs
    await page.route(`${API}/auth/refresh`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock-student-token",
          token_type: "bearer",
          expires_in: 3600,
          user_id: "student-user-id",
        }),
      });
    });

    await page.route(`${API}/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "student-user-id",
          email: STUDENT_EMAIL,
          school: "University of Waterloo",
          role: "user",
        }),
      });
    });

    await page.route(`${API}/clubs/?*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_CLUB]),
      });
    });

    // Mock membership status initially returning null (no request)
    let membershipStatus: Record<string, unknown> | null = null;
    await page.route(`${API}/clubs/1/membership`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(membershipStatus),
        });
      } else if (route.request().method() === "DELETE") {
        membershipStatus = null;
        await route.fulfill({ status: 204 });
      }
    });

    // Mock join endpoint
    await page.route(`${API}/clubs/1/join`, async (route) => {
      membershipStatus = {
        id: "membership-123",
        club_id: 1,
        user_id: "student-user-id",
        status: "pending",
        role: "member",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(membershipStatus),
      });
    });

    await seedSession(page, STUDENT_EMAIL);
    await page.goto(`${BASE}/organizations`);
    await page.waitForTimeout(1000);

    // Click on Club Card to open details modal
    const clubCard = page.getByText("UW Computer Science Club");
    await expect(clubCard).toBeVisible();
    await clubCard.click();

    // Verify modal is open and has "Request to Join" button
    await expect(page.getByRole("heading", { name: "UW Computer Science Club" })).toBeVisible();
    const joinBtn = page.getByRole("button", { name: "Request to Join" });
    await expect(joinBtn).toBeVisible();

    // Click "Request to Join"
    await joinBtn.click();

    // Verify status changes to "Request Pending" and "Cancel Request" button appears
    await expect(page.getByText("Request Pending")).toBeVisible();
    const cancelBtn = page.getByRole("button", { name: "Cancel Request" });
    await expect(cancelBtn).toBeVisible();

    // Cancel the request
    await cancelBtn.click();

    // Verify it reverts back to "Request to Join"
    await expect(page.getByRole("button", { name: "Request to Join" })).toBeVisible();
  });

  // --- Test 2: Admin can see request and approve/reject/remove members ---
  test("Organization Owner can approve pending requests and remove active members", async ({ page }) => {
    // Mock general APIs
    await page.route(`${API}/auth/refresh`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock-owner-token",
          token_type: "bearer",
          expires_in: 3600,
          user_id: "owner-user-id",
        }),
      });
    });

    await page.route(`${API}/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "owner-user-id",
          email: OWNER_EMAIL,
          school: "University of Waterloo",
          role: "user",
        }),
      });
    });

    await page.route(url => url.pathname === "/clubs/mine", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_CLUB]),
      });
    });

    // Mock memberships list
    let mockRoster = [
      {
        id: "membership-owner",
        club_id: 1,
        user_id: "owner-user-id",
        status: "approved",
        role: "owner",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user: {
          id: "owner-user-id",
          email: OWNER_EMAIL,
          username: "clubowner",
          full_name: "Club Owner",
          avatar_url: null,
        },
      },
      {
        id: "membership-pending-student",
        club_id: 1,
        user_id: "student-user-id",
        status: "pending",
        role: "member",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user: {
          id: "student-user-id",
          email: STUDENT_EMAIL,
          username: "student",
          full_name: "Test Student",
          avatar_url: null,
        },
      },
    ];

    await page.route(url => url.pathname.startsWith("/clubs/1/members"), async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockRoster),
        });
      } else if (method === "PATCH") {
        // Approve/Reject
        const targetUserId = url.split("/").pop();
        mockRoster = mockRoster.map((m) =>
          m.user_id === targetUserId ? { ...m, status: "approved" } : m
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockRoster.find((m) => m.user_id === targetUserId)),
        });
      } else if (method === "DELETE") {
        // Remove member
        const targetUserId = url.split("/").pop();
        mockRoster = mockRoster.filter((m) => m.user_id !== targetUserId);
        await route.fulfill({ status: 204 });
      }
    });

    await seedSession(page, OWNER_EMAIL, 1);
    await page.goto(`${BASE}/organizations`);

    // Wait for the active club button to appear in the top nav
    const activeClubBtn = page.locator("header").getByText("UW Computer Science Club");
    await expect(activeClubBtn).toBeVisible({ timeout: 10000 });
    await activeClubBtn.click();

    // Click on the club in the Popover list
    const switcherOption = page.locator("[aria-label='Manage your organization']").getByRole("button", { name: "UW Computer Science Club" });
    await expect(switcherOption).toBeVisible();
    await switcherOption.click();

    // Verify we navigated to /organization-panel client-side
    await expect(page).toHaveURL(`${BASE}/organization-panel`);

    // Click "Members" card to navigate client-side to /organization-panel/members
    const membersCard = page.getByText("Members", { exact: true });
    await expect(membersCard).toBeVisible();
    await membersCard.click();

    // Verify we are on /organization-panel/members
    await expect(page).toHaveURL(`${BASE}/organization-panel/members`);

    // Verify we see "Active Members (1)" initially
    await expect(page.getByRole("button", { name: "Active Members (1)" })).toBeVisible();
    await expect(page.getByText("Club Owner")).toBeVisible();

    // Go to "Pending Requests" tab
    const requestsTab = page.getByRole("button", { name: "Pending Requests (1)" });
    await expect(requestsTab).toBeVisible();
    await requestsTab.click();

    // Verify we see "Test Student" and "Approve" / "Reject" buttons
    await expect(page.getByText("Test Student")).toBeVisible();
    const approveBtn = page.getByRole("button", { name: "Approve" });
    await expect(approveBtn).toBeVisible();

    // Click "Approve"
    await approveBtn.click();
    await page.waitForTimeout(500);

    // Verify roster has refreshed and "Pending Requests" becomes 0, "Active Members" becomes 2
    await expect(page.getByRole("button", { name: "Pending Requests (0)" })).toBeVisible();
    const membersTab = page.getByRole("button", { name: "Active Members (2)" });
    await expect(membersTab).toBeVisible();

    // Go back to members tab and verify "Test Student" is now listed
    await membersTab.click();
    await expect(page.getByText("Test Student")).toBeVisible();

    // Remove "Test Student"
    const removeBtn = page.getByRole("button", { name: "Remove" });
    await expect(removeBtn).toBeVisible();
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await removeBtn.click();
    await page.waitForTimeout(500);

    // Verify Active Members becomes 1 again
    await expect(page.getByRole("button", { name: "Active Members (1)" })).toBeVisible();
    await expect(page.getByText("Test Student")).not.toBeVisible();
  });
});
