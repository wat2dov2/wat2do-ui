/**
 * useAuth Hook
 * Main public hook for authentication
 * Combines store (state) + API (async operations)
 */

import { useCallback } from "react";
import { useAuthFormState } from "@/features/auth/store/auth.store";
import {
  loginAPI,
  signupAPI,
  logoutAPI,
  fetchProfileAPI,
  updateProfileAPI,
  type UserProfile,
  ApiError,
} from "@/features/auth/api/auth.api";

export function useAuth() {
  const store = useAuthFormState();

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      const { userId } = await loginAPI(email, password);
      store.setEmail(email);
      store.setAuthenticated(true);

      // Load profile from backend
      const profile = await fetchProfileAPI();
      if (profile) {
        store.setProfile(profile);
      }
      return userId;
    },
    [store],
  );

  const handleSignup = useCallback(
    async (email: string, password: string) => {
      const { userId, confirmationRequired } = await signupAPI(email, password);
      store.setEmail(email);
      if (!confirmationRequired) {
        store.setAuthenticated(true);
      }
      return { userId, confirmationRequired };
    },
    [store],
  );

  const handleLogout = useCallback(async () => {
    await logoutAPI();
    store.clearAuth();
  }, [store]);

  const handleUpdateProfile = useCallback(
    async (profile: UserProfile) => {
      await updateProfileAPI(profile);
      store.setProfile(profile);
    },
    [store],
  );

  const handleFetchProfile = useCallback(async () => {
    const profile = await fetchProfileAPI();
    if (profile) {
      store.setProfile(profile);
    }
    return profile;
  }, [store]);

  return {
    // State
    email: store.email,
    profile: store.profile,
    isAuthenticated: store.isAuthenticated,
    profileCompleted: store.profileCompleted,

    // Async operations
    login: handleLogin,
    signup: handleSignup,
    logout: handleLogout,
    updateProfile: handleUpdateProfile,
    fetchProfile: handleFetchProfile,
  };
}

export { ApiError };
