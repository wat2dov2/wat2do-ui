/**
 * Auth API
 * Public API for authentication operations
 *
 * Access token is stored in memory (via apiClient).
 * Refresh token is in an httpOnly cookie (managed by the backend).
 */

import { api, isApiError } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import {
  loadUserEmail,
  saveUserEmail,
  loadUserProfile,
  saveUserProfile,
  saveAccessToken,
  clearAllAuthData,
  hasAccessToken,
  type UserProfile,
} from "@/features/auth/api/userRepository";
import type {
  ApiTokenResponse,
  ApiUserResponse,
  ApiOrganizationResponse,
} from "@/shared/generated";

export type { UserProfile };

/**
 * Dispatch a same-tab "auth-user-login" event so per-user stores (saved
 * events, promotions, etc.) can refetch after a successful login/signup.
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

export function isAuthenticated(): boolean {
  return hasAccessToken() && loadUserEmail() !== null;
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
  const res = await api.post<ApiTokenResponse & { onboarding_required?: boolean }>("/auth/verify-otp", {
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

export async function logoutAPI(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch (err) {
    console.error("Logout API call failed, clearing local state anyway:", err);
  }
  clearAllAuthData();
  // Reset freshness timestamp so the next admin route forces a re-fetch.
  lastProfileFetchAt = 0;
  // Broadcast logout so per-user stores (saved events, promotions) reset
  // via the "auth-user-logout" event.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event("auth-user-logout"));
    } catch (err) {
      console.error("Failed to dispatch auth-user-logout event:", err);
    }
  }
}

async function refreshTokenAPI(): Promise<boolean> {
  // Refresh token is sent automatically as an httpOnly cookie
  try {
    const res = await api.post<ApiTokenResponse>("/auth/refresh");
    saveAccessToken(res.access_token);
    return true;
  } catch (err) {
    console.error("Token refresh failed, clearing auth data:", err);
    clearAllAuthData();
    lastProfileFetchAt = 0;
    return false;
  }
}

/**
 * Initialize auth on app startup.
 * Checks if there's a hint of a prior session (userEmail in localStorage),
 * then attempts to refresh the access token via the httpOnly cookie.
 * Also refreshes the user profile (including role) so cached data stays current.
 */
export async function initializeAuth(): Promise<boolean> {
  const email = loadUserEmail();
  if (!email) return false;

  const success = await refreshTokenAPI();
  if (!success) {
    clearAllAuthData();
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
    // Fetch profile and organization ownership in parallel.
    // Organization fetch failures degrade gracefully to hasOrganization=false.
    const [data, clubs] = await Promise.all([
      api.get<ApiUserResponse>("/users/me"),
      api.get<ApiOrganizationResponse[]>("/organizations/mine").catch((err) => {
        console.error("Failed to fetch user organizations, defaulting hasOrganization to false:", err);
        return [] as ApiOrganizationResponse[];
      }),
    ]);

    const cachedProfile = loadUserProfile();
    // Membership in an organization still awaiting review grants no publishing
    // rights, so only approved organizations count towards hasOrganization.
    const approvedClubs = clubs.filter((club) => club.status === "approved");
    const associatedClub =
      approvedClubs.find((club) => club.id === cachedProfile?.organizationId) ??
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
      hasOrganization: approvedClubs.length > 0,
      clubs: approvedClubs.map((club) => ({
        id: club.id,
        organization_name: club.organization_name,
      })),
      organizationId: associatedClub?.id ?? null,
      organizationName: associatedClub?.organization_name ?? null,
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

