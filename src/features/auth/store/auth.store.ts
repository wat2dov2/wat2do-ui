/**
 * Auth Store
 * State management for authentication
 * 
 * Uses local state boundaries - only auth-related state lives here
 */

import { useState, useEffect, useCallback } from "react";
import {
  getSession,
  getUserProfile,
  isAuthenticated,
  isProfileCompleted,
  login,
  logout,
  updateUserProfile,
  type UserProfile,
} from "@/features/auth/api/auth.api";

interface AuthState {
  email: string | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  profileCompleted: boolean;
}

/**
 * Auth Store Hook
 * Manages authentication state with localStorage sync
 */
export function useAuthStore() {
  // Initialize state from localStorage
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

  // Sync with localStorage on mount and when storage changes
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

    // Listen for storage changes (e.g., from other tabs)
    window.addEventListener("storage", handleStorageChange);
    
    // Initial sync
    handleStorageChange();

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const setEmail = useCallback((email: string | null) => {
    // Update localStorage via API
    if (email) {
      login(email);
    } else {
      logout();
    }
    // Update local state
    setState((prev) => ({
      ...prev,
      email,
      isAuthenticated: email !== null,
    }));
  }, []);

  const setProfile = useCallback((profile: UserProfile | null) => {
    // Update localStorage via API
    if (profile) {
      updateUserProfile(profile);
    }
    // Update local state
    setState((prev) => ({
      ...prev,
      profile,
      profileCompleted: profile !== null && profile.faculty !== "" && profile.interests.length > 0,
    }));
  }, []);

  return {
    ...state,
    setEmail,
    setProfile,
  };
}
