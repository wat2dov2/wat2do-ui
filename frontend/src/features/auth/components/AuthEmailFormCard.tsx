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
  canContinue: boolean;
  isLoading: boolean;
  error: string | null;
}

export function AuthEmailFormCard({
  email,
  password,
  authMode,
  onEmailChange,
  onPasswordChange,
  onContinue,
  onToggleMode,
  canContinue,
  isLoading,
  error,
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
      />

      <Input
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        placeholder={isSignup ? t("auth.passwordPlaceholderSignup") : t("auth.passwordPlaceholderLogin")}
        onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
      />

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
