import { useState, useEffect, useRef } from "react";
import { loadProfile, saveProfile, type UserProfile } from "@/features/settings/api/settings.api";
import { availableSchools } from "@/shared/constants/schools";

export type { UserProfile };

const DEFAULT_PROFILE: UserProfile = {
  faculty: "",
  interests: [],
  isFirstYear: false,
  school: availableSchools[0] || "",
  role: "user",
  hasClub: false,
};

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = loadProfile();
    return saved || DEFAULT_PROFILE;
  });
  const [syncing, setSyncing] = useState(false);
  const initialLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;
    import("@/features/auth/api/auth.api").then(({ fetchProfileAPI }) => {
      fetchProfileAPI()
        .then((remote) => {
          if (!cancelled && remote) setProfile(remote);
        })
        .catch((err) => console.error("Failed to fetch profile:", err));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }
    saveProfile(profile);
    setSyncing(true);
    import("@/features/auth/api/auth.api")
      .then(({ updateProfileAPI }) => updateProfileAPI(profile))
      .catch((err) => console.error("Failed to sync profile:", err))
      .finally(() => setSyncing(false));
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

  return { profile, updateProfile, toggleInterest, syncing };
}
