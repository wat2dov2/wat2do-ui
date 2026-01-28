/**
 * useAuth Hook
 * Main public hook for authentication
 * 
 * Combines store (state) + API (operations)
 * This is the primary interface for auth functionality
 */

import { useCallback } from "react";
import { useAuthStore } from "@/features/auth/store/auth.store";
import {
  login,
  logout,
  updateUserProfile,
  type UserProfile,
} from "@/features/auth/api/auth.api";

/**
 * Main authentication hook
 * Provides auth state and operations
 */
export function useAuth() {
  const store = useAuthStore();

  const handleLogin = useCallback((email: string) => {
    login(email);
    store.setEmail(email);
  }, [store]);

  const handleLogout = useCallback(() => {
    logout();
    store.setEmail(null);
    store.setProfile(null);
  }, [store]);

  const handleUpdateProfile = useCallback((profile: UserProfile) => {
    updateUserProfile(profile);
    store.setProfile(profile);
  }, [store]);

  return {
    // State
    email: store.email,
    profile: store.profile,
    isAuthenticated: store.isAuthenticated,
    profileCompleted: store.profileCompleted,

    // Operations
    login: handleLogin,
    logout: handleLogout,
    updateProfile: handleUpdateProfile,
  };
}
