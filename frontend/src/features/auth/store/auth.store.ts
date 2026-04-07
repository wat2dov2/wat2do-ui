/**
 * Auth Store
 * State management for authentication
 * Auth initialization happens in main.tsx before React renders,
 * so tokens are already in memory by the time this mounts.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getSession,
  getUserProfile,
  isAuthenticated,
  isProfileCompleted,
  updateUserProfile,
  type UserProfile,
} from "@/features/auth/api/auth.api";
import { clearAllAuthData } from "@/features/auth/api/userRepository";

interface AuthState {
  email: string | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  profileCompleted: boolean;
}

export function useAuthStore() {
  const [state, setState] = useState<AuthState>(() => {
    const session = getSession();
    const profile = getUserProfile();
    return {
      email: session.email,
      profile,
      isAuthenticated: isAuthenticated(),
      profileCompleted: isProfileCompleted(),
    };
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const session = getSession();
      const profile = getUserProfile();
      setState({
        email: session.email,
        profile,
        isAuthenticated: isAuthenticated(),
        profileCompleted: isProfileCompleted(),
      });
    };

    window.addEventListener("storage", handleStorageChange);
    handleStorageChange();

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const setEmail = useCallback((email: string | null) => {
    setState((prev) => ({
      ...prev,
      email,
      isAuthenticated: email !== null && isAuthenticated(),
    }));
  }, []);

  const setProfile = useCallback((profile: UserProfile | null) => {
    if (profile) {
      updateUserProfile(profile);
    }
    setState((prev) => ({
      ...prev,
      profile,
      profileCompleted:
        profile !== null && profile.faculty !== "" && profile.interests.length > 0,
    }));
  }, []);

  const setAuthenticated = useCallback((authed: boolean) => {
    setState((prev) => ({ ...prev, isAuthenticated: authed }));
  }, []);

  const clearAuth = useCallback(() => {
    clearAllAuthData();
    setState({
      email: null,
      profile: null,
      isAuthenticated: false,
      profileCompleted: false,
    });
  }, []);

  return {
    ...state,
    setEmail,
    setProfile,
    setAuthenticated,
    clearAuth,
  };
}
