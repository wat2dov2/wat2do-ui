import { useCallback, useMemo, useState } from "react";
import { useAuthFlowState } from "@/features/auth/store/authFlow.store";
import { loginAPI, signupAPI, login as saveEmailLocally, ApiError } from "@/features/auth/api/auth.api";
import { DOMAIN_TO_SCHOOL } from "@/shared/constants/schools";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Map backend auth errors to user-facing messages.
 *
 * Login errors always get a generic message to prevent user-enumeration
 * (attacker cannot distinguish "no such account" from "wrong password").
 * Signup errors that reveal domain restrictions (403) are passed through
 * since they don't confirm whether a specific account exists.
 */
function sanitizeAuthError(err: ApiError, mode: AuthMode): string {
  if (mode === "login") {
    return "Invalid email or password";
  }

  // Signup: allow domain-restriction messages (403) through — they don't
  // reveal whether an individual account exists, only school eligibility.
  if (err.status === 403) {
    return err.message;
  }

  // For 409 (duplicate email/username) use a generic message so attackers
  // cannot confirm that a specific email is registered.
  if (err.status === 409) {
    return "Unable to create account — please try a different email or username";
  }

  return err.message;
}

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
  const store = useAuthFlowState();
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
        setError(sanitizeAuthError(err, authMode));
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
