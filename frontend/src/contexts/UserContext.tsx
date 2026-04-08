import { createContext, useContext, useState, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { getSession, isAuthenticated, isProfileCompleted, getUserRole, getUserHasClub } from "@/features/auth";
import { ROLE_ADMIN } from "@/shared/constants/roles";

interface UserContextValue {
  profileCompleted: boolean;
  setProfileCompleted: (completed: boolean) => void;
  userEmail: string | null;
  setUserEmail: (email: string | null) => void;
  isAdmin: boolean;
  hasClub: boolean;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const [profileCompleted, setProfileCompletedRaw] = useState(() => isProfileCompleted());
  const [userEmail, setUserEmailRaw] = useState<string | null>(() => getSession().email);

  const setProfileCompleted = useCallback((completed: boolean) => {
    setProfileCompletedRaw(completed);
  }, []);

  const setUserEmail = useCallback((email: string | null) => {
    setUserEmailRaw(email);
  }, []);

  const isAdmin = isAuthenticated() && getUserRole() === ROLE_ADMIN;
  const hasClub = isAuthenticated() && getUserHasClub();

  const value = useMemo<UserContextValue>(() => ({
    profileCompleted,
    setProfileCompleted,
    userEmail,
    setUserEmail,
    isAdmin,
    hasClub,
  }), [
    profileCompleted, setProfileCompleted,
    userEmail, setUserEmail,
    isAdmin, hasClub,
  ]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUserContext must be used within UserProvider");
  }
  return context;
}
