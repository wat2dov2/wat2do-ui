import { useCallback } from "react";
import {
  updateUserProfile,
  updateProfileAPI,
  type UserProfile,
} from "@/features/auth/api/auth.api";

/**
 * Hook that provides a fire-and-forget profile persistence function.
 *
 * Writes the profile to localStorage synchronously so the UI reflects the
 * change immediately, then kicks off the backend PATCH in the background.
 */
export function useUpdateProfile() {
  const persistProfile = useCallback((profile: UserProfile) => {
    updateUserProfile(profile);
    updateProfileAPI(profile).catch((err) =>
      console.error("Failed to persist onboarding profile:", err)
    );
  }, []);

  return { persistProfile };
}
