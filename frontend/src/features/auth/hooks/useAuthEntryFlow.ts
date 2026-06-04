import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { loginAPI, signupAPI } from "@/features/auth/api/auth.api";

import { ApiError, isApiError } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Map backend auth errors to user-facing messages.
 *
 * Login errors always get a generic message to prevent user-enumeration
 * (attacker cannot distinguish "no such account" from "wrong password").
 * Signup errors that reveal domain restrictions (403) are passed through
 * since they don't confirm whether a specific account exists.
 */
function sanitizeAuthError(err: ApiError, mode: AuthMode, t: TFunction): string {
  if (mode === "login") {
    return t("auth.invalidEmailOrPassword");
  }

  // Signup: allow domain-restriction messages (403) through — they don't
  // reveal whether an individual account exists, only school eligibility.
  if (err.status === 403) {
    return err.message;
  }

  // For 409 (duplicate email/username) use a generic message so attackers
  // cannot confirm that a specific email is registered.
  if (err.status === 409) {
    return t("auth.signupConflict");
  }

  return err.message;
}

export type AuthMode = "login" | "signup";

interface UseAuthEntryFlowOptions {
  /** Invoked on successful signup with the school derived from the email domain. */
  onContinueToOnboarding: (initialSchool: string) => void;
  onContinueToHome: (initialSchool: string) => void;
  onForgotPassword: () => void;
}

export function useAuthEntryFlow({
  onContinueToOnboarding,
  onContinueToHome,
  onForgotPassword,
}: UseAuthEntryFlowOptions) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email");
  const modeParam = searchParams.get("mode") as AuthMode | null;

  const [email, setEmail] = useState(emailParam || "");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>(modeParam || "signup");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);

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
    setConfirmationMessage(null);
  }, []);

  const handlePasswordChange = useCallback((pw: string) => {
    setPassword(pw);
    setError(null);
    setConfirmationMessage(null);
  }, []);

  const toggleAuthMode = useCallback(() => {
    setAuthMode((prev) => (prev === "login" ? "signup" : "login"));
    setError(null);
    setConfirmationMessage(null);
  }, []);

  const handleContinue = useCallback(async () => {
    if (!isFormValid || isLoading) return;

    const trimmed = email.trim();
    setIsLoading(true);
    setError(null);

    try {
      if (authMode === "signup") {
        const result = await signupAPI(trimmed, password, undefined, tokenParam || undefined);
        if (result.confirmationRequired) {
          setConfirmationMessage(t("auth.confirmationRequired"));
          return;
        }
        onContinueToOnboarding(result.school || DEFAULT_SCHOOL);
      } else {
        const result = await loginAPI(trimmed, password);
        onContinueToHome(result.school || DEFAULT_SCHOOL);
      }
    } catch (err) {
      console.error("Auth entry flow failed:", err);
      if (isApiError(err)) {
        setError(sanitizeAuthError(err, authMode, t));
      } else {
        setError(t("auth.genericError"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [isFormValid, isLoading, email, authMode, password, onContinueToOnboarding, onContinueToHome, t, tokenParam]);

  return {
    email,
    password,
    authMode,
    isEmailValid,
    isFormValid,
    isLoading,
    error,
    confirmationMessage,
    onEmailChange: handleEmailChange,
    onPasswordChange: handlePasswordChange,
    toggleAuthMode,
    onContinue: handleContinue,
    onForgotPassword,
    isEmailPrefilled: !!tokenParam,
  };

}
