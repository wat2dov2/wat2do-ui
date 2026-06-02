import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { resetPasswordAPI } from "@/features/auth/api/auth.api";
import { ROUTES } from "@/shared/constants/routes";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";

const MIN_PASSWORD_LENGTH = 8;

interface RecoveryParams {
  accessToken: string;
  refreshToken: string;
  errorDescription: string;
}

function readRecoveryParams(): RecoveryParams {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return {
    accessToken:
      hashParams.get("access_token") ?? searchParams.get("access_token") ?? "",
    refreshToken:
      hashParams.get("refresh_token") ?? searchParams.get("refresh_token") ?? "",
    errorDescription:
      hashParams.get("error_description") ??
      searchParams.get("error_description") ??
      "",
  };
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [recoveryParams] = useState(readRecoveryParams);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    recoveryParams.errorDescription || null,
  );

  useLayoutEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        document.title,
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  const validationError = useMemo(() => {
    if (!recoveryParams.accessToken) return t("auth.resetPasswordInvalidLink");
    if (!recoveryParams.refreshToken) return t("auth.resetPasswordInvalidLink");
    if (password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
      return t("auth.resetPasswordTooShort");
    }
    if (confirmPassword.length > 0 && password !== confirmPassword) {
      return t("auth.resetPasswordMismatch");
    }
    return null;
  }, [confirmPassword, password, recoveryParams.accessToken, recoveryParams.refreshToken, t]);

  const canSubmit =
    recoveryParams.accessToken.length > 0 &&
    recoveryParams.refreshToken.length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await resetPasswordAPI(
        recoveryParams.accessToken,
        recoveryParams.refreshToken,
        password,
      );
      navigate(ROUTES.HOME, { replace: true });
    } catch (err) {
      console.error("Password reset failed:", err);
      setError(getApiErrorMessage(err, t("auth.resetPasswordFailed")));
    } finally {
      setIsLoading(false);
    }
  }, [
    canSubmit,
    isLoading,
    password,
    recoveryParams.accessToken,
    recoveryParams.refreshToken,
    navigate,
    t,
  ]);

  const goToLogin = useCallback(() => {
    navigate(ROUTES.LOGIN);
  }, [navigate]);

  const content = (
    <form
      className="w-full space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <Input
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setError(null);
        }}
        placeholder={t("auth.newPasswordPlaceholder")}
        disabled={!recoveryParams.accessToken || !recoveryParams.refreshToken}
      />
      <Input
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          setError(null);
        }}
        placeholder={t("auth.confirmPasswordPlaceholder")}
        disabled={!recoveryParams.accessToken || !recoveryParams.refreshToken}
      />

      {(error || validationError) && (
        <p className="text-sm text-destructive text-center">
          {error || validationError}
        </p>
      )}

      <LoadingButton
        type="submit"
        disabled={!canSubmit}
        isLoading={isLoading}
        loadingText={t("common.pleaseWait")}
        className="w-full"
      >
        {t("auth.updatePassword")}
      </LoadingButton>

      <p className="text-center">
        <button
          type="button"
          onClick={goToLogin}
          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {t("auth.backToLogin")}
        </button>
      </p>
    </form>
  );

  return (
    <AuthPageLayout
      heading={t("auth.resetPasswordHeading")}
      description={t("auth.resetPasswordDescription")}
    >
      <div className="w-full space-y-4">
        {content}
      </div>
    </AuthPageLayout>
  );
}
