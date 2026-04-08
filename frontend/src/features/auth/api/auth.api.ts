/**
 * Auth API
 * Public API for authentication operations
 *
 * Access token is stored in memory (via apiClient).
 * Refresh token is in an httpOnly cookie (managed by the backend).
 */

import { api, ApiError } from "@/shared/services/apiClient";
import {
  loadUserEmail,
  saveUserEmail,
  loadUserProfile,
  saveUserProfile,
  saveAccessToken,
  clearAllAuthData,
  hasTokens,
  type UserProfile,
} from "@/features/auth/api/userRepository";

export type { UserProfile };

// ── Backend response shapes ──────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
}

interface SignupResponse {
  user_id: string;
  access_token?: string | null;
  token_type: string;
  expires_in?: number | null;
  confirmation_required: boolean;
}

interface BackendUserProfile {
  id: string;
  email: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  faculty?: string | null;
  school?: string | null;
  interests?: string[] | null;
  is_first_year: boolean;
  role?: "user" | "admin";
  created_at: string;
  updated_at: string;
}

interface BackendClubResponse {
  id: number;
  club_name: string;
}

// ── Sync helpers (read from localStorage / memory) ───────────────────

export function getSession(): { email: string | null } {
  return { email: loadUserEmail() };
}

export function isAuthenticated(): boolean {
  return hasTokens() && loadUserEmail() !== null;
}

export function getUserProfile(): UserProfile | null {
  return loadUserProfile();
}

export function isProfileCompleted(): boolean {
  const profile = loadUserProfile();
  return profile !== null && profile.faculty !== "" && profile.interests.length > 0;
}

export function getUserRole(): "user" | "admin" {
  const profile = loadUserProfile();
  return profile?.role ?? "user";
}

export function getUserId(): string | undefined {
  const profile = loadUserProfile();
  return profile?.id ?? undefined;
}

export function getUserHasClub(): boolean {
  const profile = loadUserProfile();
  return profile?.hasClub ?? false;
}

// ── Legacy sync login (kept for backward compat within onboarding) ──

export function login(email: string): void {
  saveUserEmail(email);
}

export function logout(): void {
  clearAllAuthData();
}

export function updateUserProfile(profile: UserProfile): void {
  saveUserProfile(profile);
}

// ── Async API calls ──────────────────────────────────────────────────

export async function signupAPI(
  email: string,
  password: string,
  username?: string,
  fullName?: string,
): Promise<{ userId: string; confirmationRequired: boolean }> {
  const res = await api.post<SignupResponse>("/auth/signup", {
    email,
    password,
    username: username ?? undefined,
    full_name: fullName ?? undefined,
  });

  if (res.access_token) {
    saveAccessToken(res.access_token);
  }
  saveUserEmail(email);

  return {
    userId: res.user_id,
    confirmationRequired: res.confirmation_required,
  };
}

export async function loginAPI(
  email: string,
  password: string,
): Promise<{ userId: string }> {
  const res = await api.post<TokenResponse>("/auth/login", {
    email,
    password,
  });

  saveAccessToken(res.access_token);
  saveUserEmail(email);

  return { userId: res.user_id };
}

export async function logoutAPI(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch (err) {
    console.error("Logout API call failed, clearing local state anyway:", err);
  }
  clearAllAuthData();
}

export async function refreshTokenAPI(): Promise<boolean> {
  // Refresh token is sent automatically as an httpOnly cookie
  try {
    const res = await api.post<TokenResponse>("/auth/refresh");
    saveAccessToken(res.access_token);
    return true;
  } catch (err) {
    console.error("Token refresh failed, clearing auth data:", err);
    clearAllAuthData();
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

export async function fetchProfileAPI(): Promise<UserProfile | null> {
  try {
    const data = await api.get<BackendUserProfile>("/users/me");

    // Check club ownership in parallel — gracefully default to false on failure.
    let hasClub = false;
    try {
      const clubs = await api.get<BackendClubResponse[]>("/clubs/mine");
      hasClub = clubs.length > 0;
    } catch (err) {
      console.error("Failed to fetch user clubs, defaulting hasClub to false:", err);
    }

    const profile: UserProfile = {
      id: data.id,
      faculty: data.faculty ?? "",
      school: data.school ?? "",
      interests: data.interests ?? [],
      isFirstYear: data.is_first_year ?? false,
      role: data.role ?? "user",
      hasClub,
    };
    saveUserProfile(profile);
    if (data.email) saveUserEmail(data.email);
    return profile;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
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
  saveUserProfile(profile);
}

export { ApiError };
