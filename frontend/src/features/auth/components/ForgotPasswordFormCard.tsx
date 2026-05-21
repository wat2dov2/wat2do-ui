import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import { api, ApiError } from "@/shared/services/apiClient";
import { EMAIL_PATTERN } from "@/features/auth/hooks/useAuthEntryFlow";

export function ForgotPasswordFormCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const isValid = useMemo(() => EMAIL_PATTERN.test(email.trim()), [email]);

  const handleSubmit = useCallback(async () => {
    if (!isValid || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      console.error("Forgot password request failed:", err);
      setError(err instanceof ApiError ? err.message : t("auth.genericError"));
    } finally {
      setIsLoading(false);
    }
  }, [isValid, isLoading, email, t]);

  const handleBackToLogin = useCallback(() => {
    navigate(ROUTES.LOGIN);
  }, [navigate]);

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 text-center">
            {t("auth.forgotPasswordSent")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleBackToLogin}
          className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {t("auth.backToLogin")}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        placeholder={t("auth.emailPlaceholder")}
        onKeyDown={(e) => e.key === "Enter" && isValid && handleSubmit()}
      />

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <LoadingButton
        type="button"
        onClick={handleSubmit}
        disabled={!isValid}
        isLoading={isLoading}
        loadingText={t("common.pleaseWait")}
        className="w-full"
      >
        {t("auth.sendResetLink")}
      </LoadingButton>

      <p className="text-center">
        <button
          type="button"
          onClick={handleBackToLogin}
          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {t("auth.backToLogin")}
        </button>
      </p>
    </div>
  );
}
