import { useCallback, useMemo, useState } from "react";
import { useAuthFlowStore } from "@/features/auth/store/authFlow.store";
import { loginAPI, signupAPI, login as saveEmailLocally, ApiError } from "@/features/auth/api/auth.api";

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

export type AuthMode = "login" | "signup";

interface UseAuthEntryFlowOptions {
  onContinueToOnboarding: () => void;
  onContinueToHome: () => void;
}

export function useAuthEntryFlow({
  onContinueToOnboarding,
  onContinueToHome,
}: UseAuthEntryFlowOptions) {
  const store = useAuthFlowStore();
  const { authEntry } = store.state;

  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmailValid = useMemo(
    () => EMAIL_PATTERN.test(authEntry.email.trim()),
    [authEntry.email],
  );

  const isFormValid = useMemo(
    () => isEmailValid && password.length >= 6,
    [isEmailValid, password],
  );

  const handleEmailChange = useCallback(
    (email: string) => {
      store.setAuthEmail(email);
      setError(null);
    },
    [store],
  );

  const handlePasswordChange = useCallback((pw: string) => {
    setPassword(pw);
    setError(null);
  }, []);

  const toggleAuthMode = useCallback(() => {
    setAuthMode((prev) => (prev === "login" ? "signup" : "login"));
    setError(null);
  }, []);

  const handleContinue = useCallback(async () => {
    if (!isFormValid || isLoading) return;

    const email = authEntry.email.trim();
    setIsLoading(true);
    setError(null);

    try {
      if (authMode === "signup") {
        await signupAPI(email, password);
        saveEmailLocally(email);
        store.setSchool(schoolFromEmail(email));
        onContinueToOnboarding();
      } else {
        await loginAPI(email, password);
        saveEmailLocally(email);
        onContinueToHome();
      }
    } catch (err) {
      console.error("Auth entry flow failed:", err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [isFormValid, isLoading, authEntry.email, authMode, password, store, onContinueToOnboarding, onContinueToHome]);

  return {
    email: authEntry.email,
    password,
    authMode,
    isEmailValid,
    isFormValid,
    isLoading,
    error,
    onEmailChange: handleEmailChange,
    onPasswordChange: handlePasswordChange,
    toggleAuthMode,
    onContinue: handleContinue,
  };
}
