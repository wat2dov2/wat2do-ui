import { useCallback, useMemo, useState } from "react";
import { loginAPI, signupAPI } from "@/features/auth/api/auth.api";
import { ApiError } from "@/shared/services/apiClient";
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
  /** Invoked on successful signup with the school derived from the email domain. */
  onContinueToOnboarding: (initialSchool: string) => void;
  onContinueToHome: () => void;
}

export function useAuthEntryFlow({
  onContinueToOnboarding,
  onContinueToHome,
}: UseAuthEntryFlowOptions) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmailValid = useMemo(
    () => EMAIL_PATTERN.test(email.trim()),
    [email],
  );

  const isFormValid = useMemo(
    () => isEmailValid && password.length >= 6,
    [isEmailValid, password],
  );

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setError(null);
  }, []);

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

    const trimmed = email.trim();
    setIsLoading(true);
    setError(null);

    try {
      if (authMode === "signup") {
        await signupAPI(trimmed, password);
        // signupAPI already cached the email; hand the school to the
        // onboarding page via navigation state so step 3's goose dialogue
        // can greet the user by school name.
        onContinueToOnboarding(schoolFromEmail(trimmed));
      } else {
        await loginAPI(trimmed, password);
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
  }, [isFormValid, isLoading, email, authMode, password, onContinueToOnboarding, onContinueToHome]);

  return {
    email,
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
