import { useState, useEffect, useCallback, useRef } from "react";
import { loadProfile, saveProfile, type UserProfile } from "@/features/settings/api/settings.api";
import { fetchProfileAPI, getLastProfileFetchAt, updateProfileAPI } from "@/features/auth";
import { availableSchools } from "@/shared/constants/schools";

/**
 * How long a `/users/me` fetch remains fresh before Settings will re-fetch.
 * Paired with `initializeAuth()` + the silent-refresh `onAfterRefresh` hook
 * in `main.tsx`, most Settings mounts hit the cache.
 */
const PROFILE_STALE_TTL_MS = 60_000;

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
  // Tracks whether the user has started editing locally. Once true, the
  // background fetch must not overwrite local edits.
  const hasLocalEditsRef = useRef(false);
  // Serialize PATCH requests so concurrent edits reach the backend in the
  // order they were issued (out-of-order processing would clobber fields).
  // Also track the in-flight count so `syncing` only clears when the queue
  // is fully drained.
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSyncsRef = useRef(0);

  useEffect(() => {
    // Skip the network round-trip if a recent fetchProfileAPI is cached.
    // initializeAuth + the silent-refresh hook already populate this on
    // startup, so most Settings mounts hit the cache.
    const stale = Date.now() - getLastProfileFetchAt() > PROFILE_STALE_TTL_MS;
    if (!stale) return;

    let cancelled = false;
    fetchProfileAPI()
      .then((remote) => {
        if (cancelled) return;
        if (hasLocalEditsRef.current) return;
        if (remote) setProfile(remote);
      })
      .catch((err) => console.error("Failed to fetch profile:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const syncProfile = useCallback((updated: UserProfile) => {
    saveProfile(updated);
    pendingSyncsRef.current += 1;
    setSyncing(true);
    syncQueueRef.current = syncQueueRef.current.then(() =>
      updateProfileAPI(updated)
        .catch((err) => console.error("Failed to sync profile:", err))
        .finally(() => {
          pendingSyncsRef.current -= 1;
          if (pendingSyncsRef.current === 0) setSyncing(false);
        }),
    );
  }, []);

  const updateProfile = (updates: Partial<UserProfile>) => {
    hasLocalEditsRef.current = true;
    setProfile((prev) => {
      const updated = { ...prev, ...updates };
      syncProfile(updated);
      return updated;
    });
  };

  const toggleInterest = (interest: string) => {
    hasLocalEditsRef.current = true;
    setProfile((prev) => {
      const updated = {
        ...prev,
        interests: prev.interests.includes(interest)
          ? prev.interests.filter((i) => i !== interest)
          : [...prev.interests, interest],
      };
      syncProfile(updated);
      return updated;
    });
  };

  return { profile, updateProfile, toggleInterest, syncing };
}
