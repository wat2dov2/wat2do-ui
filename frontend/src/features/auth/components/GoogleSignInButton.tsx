import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getGoogleOAuthStartUrl } from "@/features/auth/api/auth.api";
import {
  SignInWindowBlockedError,
  signInWithGoogleWindow,
} from "@/features/auth/api/googleWindow";
import { LoadingButton } from "@/shared/ui/loading-button";
import { GoogleIcon } from "@/shared/ui/platform-icons";
import { Separator } from "@/shared/ui/separator";

interface GoogleSignInButtonProps {
  returnTo?: string;
  disabled?: boolean;
  hasError?: boolean;
  /**
   * Signs in with Google in a window of its own and calls this once this page
   * is signed in, so the page keeps its state (the sign-in dialog over a
   * half-filled form). Without it, the page itself goes to Google.
   */
  onSignedIn?: () => void;
}

type WindowError = "blocked" | "failed";

export function GoogleSignInButton({
  returnTo,
  hasError = false,
  disabled = false,
  onSignedIn,
}: GoogleSignInButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [windowError, setWindowError] = useState<WindowError | null>(null);
  const waiting = useRef<AbortController | null>(null);

  useEffect(() => () => waiting.current?.abort(), []);

  // The window can be closed without signing in. Back on this page the button
  // works again, while the wait for a finished sign-in carries on.
  useEffect(() => {
    if (!isLoading || !onSignedIn) return;
    const ready = () => setIsLoading(false);
    window.addEventListener("focus", ready);
    return () => window.removeEventListener("focus", ready);
  }, [isLoading, onSignedIn]);

  const handleGoogleSignIn = () => {
    setIsLoading(true);
    if (!onSignedIn) {
      window.location.assign(getGoogleOAuthStartUrl(returnTo));
      return;
    }
    waiting.current?.abort();
    const controller = new AbortController();
    waiting.current = controller;
    setWindowError(null);
    signInWithGoogleWindow(controller.signal).then(onSignedIn, (error: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Google sign-in window failed:", error);
      setIsLoading(false);
      setWindowError(error instanceof SignInWindowBlockedError ? "blocked" : "failed");
    });
  };

  const errorMessage =
    windowError === "blocked"
      ? t("auth.googleWindowBlocked")
      : hasError || windowError === "failed"
        ? t("auth.googleError")
        : null;

  return (
    <div className="space-y-4">
      <LoadingButton
        type="button"
        disabled={disabled}
        variant="outline"
        className="w-full"
        isLoading={isLoading}
        loadingText={onSignedIn ? t("auth.googleWindowOpen") : t("auth.googleRedirecting")}
        onClick={handleGoogleSignIn}
      >
        <GoogleIcon className="size-4" />
        {t("auth.continueWithGoogle")}
      </LoadingButton>
      {errorMessage ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {errorMessage}
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
