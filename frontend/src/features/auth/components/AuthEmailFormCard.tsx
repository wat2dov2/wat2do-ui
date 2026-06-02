import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Input } from "@/shared/ui/input";
import type { AuthMode } from "@/features/auth/hooks/useAuthEntryFlow";

interface AuthEmailFormCardProps {
  email: string;
  password: string;
  authMode: AuthMode;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onContinue: () => void;
  onToggleMode: () => void;
  onForgotPassword: () => void;
  canContinue: boolean;
  isLoading: boolean;
  error: string | null;
  confirmationMessage: string | null;
  isEmailPrefilled?: boolean;
}

export function AuthEmailFormCard({
  email,
  password,
  authMode,
  onEmailChange,
  onPasswordChange,
  onContinue,
  onToggleMode,
  onForgotPassword,
  canContinue,
  isLoading,
  error,
  confirmationMessage,
  isEmailPrefilled = false,
}: AuthEmailFormCardProps) {
  const { t } = useTranslation();
  const isSignup = authMode === "signup";

  return (
    <div className="w-full space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder={t("auth.emailPlaceholder")}
        onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
        disabled={isEmailPrefilled}
      />


      <Input
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        placeholder={isSignup ? t("auth.passwordPlaceholderSignup") : t("auth.passwordPlaceholderLogin")}
        onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
      />

      {confirmationMessage && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 text-center">{confirmationMessage}</p>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <LoadingButton
        type="button"
        onClick={onContinue}
        disabled={!canContinue}
        isLoading={isLoading}
        loadingText={t("common.pleaseWait")}
        className="w-full"
      >
        {isSignup ? t("auth.createAccount") : t("auth.signIn")}
      </LoadingButton>

      {!isSignup && (
        <p className="text-center">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            {t("auth.forgotPassword")}
          </button>
        </p>
      )}

      <p className="text-[11px] text-center text-muted-foreground">
        {isSignup ? t("auth.alreadyHaveAccount") : t("auth.dontHaveAccount")}{" "}
        <button
          type="button"
          onClick={onToggleMode}
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          {isSignup ? t("auth.signInLink") : t("auth.createOneLink")}
        </button>
      </p>

      <p className="text-[11px] text-center text-muted-foreground">
        {t("auth.termsNotice")}
      </p>
    </div>
  );
}
