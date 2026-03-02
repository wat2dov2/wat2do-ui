import { useCallback, useMemo } from "react";
import { useAuthFlowStore } from "@/features/auth/store/authFlow.store";
import { login } from "@/features/auth/api/auth.api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DOMAIN_TO_SCHOOL: Record<string, string> = {
  "uwaterloo.ca": "University of Waterloo",
  "utoronto.ca": "University of Toronto",
  "mail.utoronto.ca": "University of Toronto",
  "mcgill.ca": "McGill University",
  "mail.mcgill.ca": "McGill University",
  "ubc.ca": "University of British Columbia",
  "student.ubc.ca": "University of British Columbia",
  "mcmaster.ca": "McMaster University",
};

function schoolFromEmail(email: string): string {
  const domain = email.trim().split("@")[1]?.toLowerCase() ?? "";
  return DOMAIN_TO_SCHOOL[domain] ?? "";
}

interface UseAuthEntryFlowOptions {
  onContinueToOnboarding: () => void;
}

export function useAuthEntryFlow({ onContinueToOnboarding }: UseAuthEntryFlowOptions) {
  const store = useAuthFlowStore();
  const { authEntry } = store.state;

  const isEmailValid = useMemo(
    () => EMAIL_PATTERN.test(authEntry.email.trim()),
    [authEntry.email]
  );

  const handleEmailChange = useCallback(
    (email: string) => {
      store.setAuthEmail(email);
    },
    [store]
  );

  const handleContinueFromEmail = useCallback(() => {
    if (!isEmailValid) return;
    const email = authEntry.email.trim();
    login(email);
    store.setSchool(schoolFromEmail(email));
    onContinueToOnboarding();
  }, [isEmailValid, authEntry.email, store, onContinueToOnboarding]);

  return {
    email: authEntry.email,
    isEmailValid,
    onEmailChange: handleEmailChange,
    onContinueFromEmail: handleContinueFromEmail,
  };
}
