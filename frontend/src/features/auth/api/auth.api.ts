/**
 * Auth API
 * Public API for authentication operations
 *
 * Access token is stored in memory (via apiClient).
 * Refresh token is in an httpOnly cookie (managed by the backend).
 */

import { api, isApiError, refreshAccessToken } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import {
  loadUserEmail,
  saveUserEmail,
  loadUserProfile,
  saveUserProfile,
  saveAccessToken,
  clearAllAuthData,
  type UserProfile,
} from "@/features/auth/api/userRepository";
import type {
  ApiTokenResponse,
  ApiUserResponse,
  ApiClubResponse,
} from "@/shared/generated";

export type { UserProfile };

/**
 * Dispatch a same-tab "auth-user-login" event so per-user stores (saved
 * events, etc.) can refetch after a successful login/signup.
 * Mirrors the "auth-user-logout" broadcast in logoutAPI.
 */
function dispatchAuthUserLogin(school?: string): void {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("auth-user-login", { detail: { school } }));
    } catch (err) {
      console.error("Failed to dispatch auth-user-login event:", err);
    }
  }
}

// ── Sync helpers (read from localStorage / memory) ───────────────────

export function getSessionEmail(): string | null {
  return loadUserEmail();
}

/**
 * Whether a signed-in session is cached, matching `useAuthState().isAuthenticated`.
 *
 * Deliberately not "is there an access token": the token is in memory only and
 * is absent until `/auth/refresh` returns, so gating on it would answer "no" for
 * a signed-in user on every page load. Callers that fetch are unaffected -
 * `apiClient` refreshes and retries a 401 by itself.
 */
export function isAuthenticated(): boolean {
  return loadUserEmail() !== null;
}

export function getUserProfile(): UserProfile | null {
  return loadUserProfile();
}

export function getUserId(): string | undefined {
  const profile = loadUserProfile();
  return profile?.id;
}

export function updateUserProfile(profile: UserProfile): void {
  saveUserProfile(profile);
}

// ── Async API calls ──────────────────────────────────────────────────

export async function sendOtpAPI(
  email: string,
  token?: string,
  returnTo?: string,
): Promise<void> {
  await api.post("/auth/send-otp", {
    email,
    token: token ?? undefined,
    return_to: returnTo ?? undefined,
  });
}

export async function verifyOtpAPI(
  email: string,
  token: string,
): Promise<{ userId: string; school: string; onboardingRequired: boolean }> {
  const res = await api.post<ApiTokenResponse>("/auth/verify-otp", {
    email,
    token,
  });

  saveAccessToken(res.access_token);
  saveUserEmail(email);
  await fetchProfileAPI();
  const school = res.school?.trim() || DEFAULT_SCHOOL;

  dispatchAuthUserLogin(school);

  return {
    userId: res.user_id,
    school,
    onboardingRequired: !!res.onboarding_required,
  };
}

export function getGoogleOAuthStartUrl(returnTo?: string): string {
  const startUrl = new URL(`${API_BASE_URL}/auth/google`, window.location.origin);
  startUrl.searchParams.set(
    "callback_url",
    `${window.location.origin}/api/auth/google/callback`,
  );
  if (returnTo) {
    startUrl.searchParams.set("return_to", returnTo);
  }
  return startUrl.toString();
}

export async function completeGoogleOAuthAPI(): Promise<UserProfile> {
  const refreshOutcome = await refreshAccessToken();
  if (refreshOutcome !== "refreshed") {
    throw new Error("Google sign-in session could not be completed");
  }

  const profile = await fetchProfileAPI();
  if (!profile || !loadUserEmail()) {
    throw new Error("Google sign-in profile could not be loaded");
  }
  dispatchAuthUserLogin(profile.school);
  return profile;
}

export async function logoutAPI(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch (err) {
    console.error("Logout API call failed, clearing local state anyway:", err);
  }
  clearAllAuthData();
  // Reset freshness timestamp so the next admin route forces a re-fetch.
  lastProfileFetchAt = 0;
  // Broadcast logout so per-user stores (saved events) reset
  // via the "auth-user-logout" event.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event("auth-user-logout"));
    } catch (err) {
      console.error("Failed to dispatch auth-user-logout event:", err);
    }
  }
}

/**
 * Initialize auth on app startup.
 * Restore the shared httpOnly session even on a campus with no local cache.
 * Refresh the user profile (including role) after the cookie is verified.
 *
 * A session that could not be refreshed because the server was unreachable is
 * left alone rather than cleared: the cached session is still the best thing we
 * know, and the next request will refresh it. A definitive rejection clears the
 * cache below.
 */
export async function initializeAuth(): Promise<boolean> {
  const refreshOutcome = await refreshAccessToken();
  if (refreshOutcome === "rejected") {
    clearAllAuthData();
    lastProfileFetchAt = 0;
  }
  if (refreshOutcome !== "refreshed") {
    return false;
  }

  // Refresh profile (including role) so cached data stays in sync with backend.
  try {
    await fetchProfileAPI();
  } catch (err) {
    console.error("Profile fetch during auth init failed, continuing with cached data:", err);
  }

  return true;
}

/** Timestamp (ms since epoch) of the last successful fetchProfileAPI. */
let lastProfileFetchAt = 0;

export function getLastProfileFetchAt(): number {
  return lastProfileFetchAt;
}

export async function fetchProfileAPI(): Promise<UserProfile | null> {
  try {
    // Fetch profile and club ownership in parallel.
    // Club fetch failures degrade gracefully to hasClub=false.
    const [data, clubs] = await Promise.all([
      api.get<ApiUserResponse>("/users/me"),
      api.get<ApiClubResponse[]>("/clubs/mine").catch((err) => {
        console.error("Failed to fetch user clubs, defaulting hasClub to false:", err);
        return [] as ApiClubResponse[];
      }),
    ]);

    const cachedProfile = loadUserProfile();
    // Membership in a club still awaiting review grants no publishing
    // rights, so only approved clubs count towards hasClub.
    const approvedClubs = clubs.filter((club) => club.status === "approved");
    const associatedClub =
      approvedClubs.find((club) => club.id === cachedProfile?.clubId) ??
      approvedClubs[0] ??
      null;
    const profile: UserProfile = {
      id: data.id,
      fullName: data.full_name ?? null,
      avatarUrl: data.avatar_url ?? null,
      faculty: data.faculty ?? "",
      school: data.school ?? "",
      interests: data.interests ?? [],
      isFirstYear: data.is_first_year ?? false,
      role: data.role ?? "user",
      hasClub: approvedClubs.length > 0,
      clubs: approvedClubs.map((club) => ({
        id: club.id,
        club_name: club.club_name,
      })),
      clubId: associatedClub?.id ?? null,
      clubName: associatedClub?.club_name ?? null,
      payoutEmail: data.payout_email ?? null,
      promoterTosAcceptedAt: data.promoter_tos_accepted_at ?? null,
      promoterTosVersion: data.promoter_tos_version ?? null,
    };
    saveUserProfile(profile);
    if (data.email) saveUserEmail(data.email);
    lastProfileFetchAt = Date.now();
    return profile;
  } catch (err) {
    if (isApiError(err) && err.status === 404) {
      console.warn("No profile row for current auth user:", err);
      return null;
    }
    throw err;
  }
}

export async function updateProfileAPI(profile: UserProfile): Promise<void> {
  await api.patch("/users/me/profile", {
    faculty: profile.faculty || null,
    school: profile.school || null,
    interests: profile.interests,
    is_first_year: profile.isFirstYear,
  });
  // Caller is expected to sync localStorage (via updateUserProfile) before
  // invoking us. The PATCH does not return a new shape, so there is nothing
  // to reconcile here - re-saving would just fire another redundant
  // auth-state-refresh event.
}
