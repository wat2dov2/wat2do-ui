import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getGoogleOAuthStartUrl } from "@/features/auth/api/auth.api";
import { LoadingButton } from "@/shared/ui/loading-button";
import { GoogleIcon } from "@/shared/ui/platform-icons";
import { Separator } from "@/shared/ui/separator";

interface GoogleSignInButtonProps {
  returnTo?: string;
  hasError?: boolean;
}

export function GoogleSignInButton({
  returnTo,
  hasError = false,
}: GoogleSignInButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = () => {
    setIsLoading(true);
    window.location.assign(getGoogleOAuthStartUrl(returnTo));
  };

  return (
    <div className="space-y-4">
      <LoadingButton
        type="button"
        variant="outline"
        className="w-full"
        isLoading={isLoading}
        loadingText={t("auth.googleRedirecting")}
        onClick={handleGoogleSignIn}
      >
        <GoogleIcon className="size-4" />
        {t("auth.continueWithGoogle")}
      </LoadingButton>
      {hasError ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {t("auth.googleError")}
        </p>
      ) : null}
      <div className="flex items-center gap-3" aria-hidden="true">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {t("auth.orContinueWithEmail")}
        </span>
        <Separator className="flex-1" />
      </div>
    </div>
  );
}
