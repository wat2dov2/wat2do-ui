import { useCallback, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { sendOtpAPI, verifyOtpAPI } from "@/features/auth/api/auth.api";

import { ApiError, isApiError } from "@/shared/services/apiClient";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Answers that refuse what was typed: a wrong or expired code (401), or an
 * email this school does not sign in (403). Any other failure is not the
 * field's fault.
 */
const REFUSED_STATUSES = new Set([401, 403]);

interface FlowError {
  message: string;
  /** The server refused the typed email or code, so that field is marked too. */
  refused: boolean;
}

function sanitizeAuthError(err: ApiError, t: TFunction): string {
  // Allow domain-restriction messages (403) through - they don't
  // reveal whether an individual account exists, only school eligibility.
  if (err.status === 403) {
    return err.message;
  }

  if (err.status === 401) {
    return t("auth.invalidOtp");
  }

  return err.message;
}

interface UseEmailOtpFlowOptions {
  initialEmail?: string;
  invitationToken?: string;
  returnTo?: string;
}

export type VerifiedOtpSession = Awaited<ReturnType<typeof verifyOtpAPI>>;

export function useEmailOtpFlow({
  initialEmail = "",
  invitationToken,
  returnTo,
}: UseEmailOtpFlowOptions = {}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [otpToken, setOtpToken] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);
  const authRequestInFlightRef = useRef(false);
  const isEmailValid = EMAIL_PATTERN.test(email.trim());
  const isFormValid = emailSent
    ? otpToken.trim().length === 6
    : isEmailValid;

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setError(null);
  }, []);

  const handleOtpChange = useCallback((value: string) => {
    setOtpToken(value);
    setError(null);
  }, []);

  const handleError = useCallback(
    (context: string, err: unknown) => {
      console.error(context, err);
      setError(
        isApiError(err)
          ? { message: sanitizeAuthError(err, t), refused: REFUSED_STATUSES.has(err.status) }
          : { message: t("auth.genericError"), refused: false },
      );
    },
    [t],
  );

  const handleResend = useCallback(async () => {
    if (isLoading || authRequestInFlightRef.current) return;
    const trimmed = email.trim();
    authRequestInFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      await sendOtpAPI(trimmed, invitationToken, returnTo);
    } catch (err) {
      handleError("Resend OTP failed:", err);
    } finally {
      authRequestInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [email, handleError, invitationToken, isLoading, returnTo]);

  const handleSubmit = useCallback(async (): Promise<VerifiedOtpSession | null> => {
    if (!isFormValid || isLoading || authRequestInFlightRef.current) {
      return null;
    }

    const trimmed = email.trim();
    authRequestInFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      if (!emailSent) {
        await sendOtpAPI(trimmed, invitationToken, returnTo);
        setEmailSent(true);
        return null;
      }

      return await verifyOtpAPI(trimmed, otpToken.trim());
    } catch (err) {
      handleError("Email OTP flow failed:", err);
      return null;
    } finally {
      authRequestInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [
    email,
    emailSent,
    handleError,
    invitationToken,
    isFormValid,
    isLoading,
    otpToken,
    returnTo,
  ]);

  return {
    email,
    otpToken,
    emailSent,
    isFormValid,
    isLoading,
    error: error?.message ?? null,
    /** Cleared by the next edit or attempt, so each refusal marks the field afresh. */
    isRefused: error?.refused ?? false,
    onEmailChange: handleEmailChange,
    onOtpChange: handleOtpChange,
    onSubmit: handleSubmit,
    onResend: handleResend,
  };
}
