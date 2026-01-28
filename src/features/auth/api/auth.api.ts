/**
 * Auth API
 * Public API for authentication operations
 * 
 * This is the internal contract for the auth feature.
 * Other features consume these interfaces, not implementations.
 */

import {
  loadUserEmail,
  saveUserEmail,
  loadUserProfile,
  saveUserProfile,
  type UserProfile,
} from "@/features/auth/api/userRepository";

// Re-export types for external use
export type { UserProfile };

/**
 * Get current user session (email)
 */
export function getSession(): { email: string | null } {
  return {
    email: loadUserEmail(),
  };
}

/**
 * Login - save user email
 */
export function login(email: string): void {
  saveUserEmail(email);
}

/**
 * Logout - clear user session
 */
export function logout(): void {
  saveUserEmail(null);
}

/**
 * Get user profile
 */
export function getUserProfile(): UserProfile | null {
  return loadUserProfile();
}

/**
 * Update user profile
 */
export function updateUserProfile(profile: UserProfile): void {
  saveUserProfile(profile);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return loadUserEmail() !== null;
}

/**
 * Check if user profile is completed
 */
export function isProfileCompleted(): boolean {
  const profile = loadUserProfile();
  return profile !== null && profile.faculty !== "" && profile.interests.length > 0;
}
