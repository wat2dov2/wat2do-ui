import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { sendOtpAPI, verifyOtpAPI } from "@/features/auth/api/auth.api";

import { ApiError, isApiError } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeAuthError(err: ApiError, t: TFunction): string {
  // Allow domain-restriction messages (403) through — they don't
  // reveal whether an individual account exists, only school eligibility.
  if (err.status === 403) {
    return err.message;
  }

  if (err.status === 401) {
    return t("auth.resetPasswordInvalidLink") || "Invalid or expired login code";
  }

  return err.message;
}

export interface UseAuthEntryFlowOptions {
  /** Invoked on successful signup/login with the school. */
  onContinueToOnboarding: (initialSchool: string) => void;
  onContinueToHome: (initialSchool: string) => void;
}

export function useAuthEntryFlow({
  onContinueToOnboarding,
  onContinueToHome,
}: UseAuthEntryFlowOptions) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email");

  const [email, setEmail] = useState(emailParam || "");
  const [otpToken, setOtpToken] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmailValid = useMemo(
    () => EMAIL_PATTERN.test(email.trim()),
    [email],
  );

  const isFormValid = useMemo(
    () => emailSent ? otpToken.trim().length === 6 : isEmailValid,
    [emailSent, isEmailValid, otpToken],
  );

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setError(null);
  }, []);

  const handleOtpChange = useCallback((value: string) => {
    setOtpToken(value);
    setError(null);
  }, []);

  const handleResend = useCallback(async () => {
    if (isLoading) return;
    const trimmed = email.trim();
    setIsLoading(true);
    setError(null);

    try {
      await sendOtpAPI(trimmed, tokenParam || undefined);
    } catch (err) {
      console.error("Resend OTP failed:", err);
      if (isApiError(err)) {
        setError(sanitizeAuthError(err, t));
      } else {
        setError(t("auth.genericError"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [email, tokenParam, isLoading, t]);

  const handleContinue = useCallback(async () => {
    if (!isFormValid || isLoading) return;

    const trimmed = email.trim();
    setIsLoading(true);
    setError(null);

    try {
      if (!emailSent) {
        await sendOtpAPI(trimmed, tokenParam || undefined);
        setEmailSent(true);
      } else {
        const result = await verifyOtpAPI(trimmed, otpToken.trim());
        if (result.onboardingRequired) {
          onContinueToOnboarding(result.school || DEFAULT_SCHOOL);
        } else {
          onContinueToHome(result.school || DEFAULT_SCHOOL);
        }
      }
    } catch (err) {
      console.error("Auth entry flow failed:", err);
      if (isApiError(err)) {
        setError(sanitizeAuthError(err, t));
      } else {
        setError(t("auth.genericError"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [isFormValid, isLoading, email, emailSent, otpToken, onContinueToOnboarding, onContinueToHome, t, tokenParam]);

  return {
    email,
    otpToken,
    emailSent,
    isEmailValid,
    isFormValid,
    isLoading,
    error,
    onEmailChange: handleEmailChange,
    onOtpChange: handleOtpChange,
    onContinue: handleContinue,
    onResend: handleResend,
    isEmailPrefilled: !!tokenParam,
  };
}
