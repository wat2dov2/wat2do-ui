/**
 * useProfile Hook
 * Manages user profile state and operations
 */

import { useState, useEffect } from "react";
import { loadProfile, saveProfile, type UserProfile } from "@/features/settings/api/settings.api";
import { availableSchools } from "@/features/events/data/events";

// Re-export for convenience
export type { UserProfile };

const DEFAULT_PROFILE: UserProfile = {
  faculty: "",
  interests: [],
  isFirstYear: false,
  school: availableSchools[0] || "",
};

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = loadProfile();
    return saved || DEFAULT_PROFILE;
  });

  // Persist profile changes
  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const updateProfile = (updates: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  };

  const toggleInterest = (interest: string) => {
    setProfile((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  };

  return {
    profile,
    updateProfile,
    toggleInterest,
  };
}
