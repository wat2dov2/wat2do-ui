import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  completeGoogleOAuthAPI,
  verifyOtpAPI,
} from "@/features/auth/api/auth.api";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { LoadingButton } from "@/shared/ui/loading-button";
import { appendSafeReturnTo, getSafeReturnTo } from "@/features/auth/utils/returnTo";

/**
 * Module-level guard so a token is only verified once per page session.
 * Survives React Strict Mode remounts (refs alone do not).
 */
const verifyingTokens = new Set<string>();
const completingOAuthCallbacks = new Set<string>();

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const oauthProvider = searchParams.get(QP.OAUTH_PROVIDER);
  const isGoogleCallback = oauthProvider === "google";
  const oauthSchool = searchParams.get(QP.SCHOOL) || DEFAULT_SCHOOL;
  const oauthOnboardingRequired =
    searchParams.get(QP.ONBOARDING_REQUIRED) === "true";
  const returnTo = getSafeReturnTo(searchParams.get(QP.RETURN_TO));
  const hasValidParams = isGoogleCallback || Boolean(token && email);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(isGoogleCallback);
  const inFlightRef = useRef(false);

  const navigateAfterAuthentication = useCallback(
    (school: string, onboardingRequired: boolean) => {
      if (onboardingRequired) {
        const onboardingPath = `${ROUTES.ONBOARDING}?${new URLSearchParams({
          [QP.SCHOOL]: school,
        })}`;
        router.replace(appendSafeReturnTo(onboardingPath, returnTo));
        return;
      }

      router.replace(
        returnTo ??
          `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: school })}`,
      );
    },
    [returnTo, router],
  );

  useEffect(() => {
    if (!isGoogleCallback) return;

    const key = `${oauthSchool}:${oauthOnboardingRequired}:${returnTo ?? ""}`;
    if (completingOAuthCallbacks.has(key)) return;
    completingOAuthCallbacks.add(key);

    void completeGoogleOAuthAPI()
      .then((profile) => {
        navigateAfterAuthentication(
          profile.school || oauthSchool,
          oauthOnboardingRequired,
        );
      })
      .catch((err) => {
        console.error("Google auth callback completion failed:", err);
        completingOAuthCallbacks.delete(key);
        setError(t("auth.googleError"));
        setIsLoading(false);
      });
  }, [
    isGoogleCallback,
    navigateAfterAuthentication,
    oauthOnboardingRequired,
    oauthSchool,
    returnTo,
    t,
  ]);

  async function handleConfirm() {
    if (!token || !email || isLoading || inFlightRef.current) return;

    const key = `${email}:${token}`;
    if (verifyingTokens.has(key)) return;

    inFlightRef.current = true;
    verifyingTokens.add(key);
    setIsLoading(true);
    setError(null);

    try {
      const result = await verifyOtpAPI(email, token);
      const school = result.school || DEFAULT_SCHOOL;

      navigateAfterAuthentication(school, result.onboardingRequired);
    } catch (err) {
      console.error("Auth callback verification failed:", err);
      verifyingTokens.delete(key);
      setError(t("auth.invalidLoginLink"));
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      back={
        error || !hasValidParams
          ? {
              label: t("auth.backToLogin"),
              onClick: () => router.replace(ROUTES.LOGIN),
            }
          : undefined
      }
      description={
        error
          ? t("auth.genericError")
          : isGoogleCallback
            ? t("auth.googleCallbackDescription")
            : hasValidParams
              ? t("auth.callbackDescription", { email })
              : t("auth.invalidLoginLink")
      }
    >
      <div className="w-full flex flex-col items-center justify-center py-8 space-y-4">
        {error || !hasValidParams ? (
          <p className="text-sm text-destructive text-center max-w-xs">
            {error || t("auth.invalidLoginLink")}
          </p>
        ) : isGoogleCallback ? (
          <LoadingButton
            type="button"
            isLoading
            loadingText={t("auth.googleCompleting")}
            className="w-full"
          >
            {t("auth.googleCompleting")}
          </LoadingButton>
        ) : (
          <LoadingButton
            type="button"
            onClick={handleConfirm}
            isLoading={isLoading}
            loadingText={t("common.pleaseWait")}
            className="w-full"
            autoFocus
          >
            {t("auth.callbackContinue")}
          </LoadingButton>
        )}
      </div>
    </AuthPageLayout>
  );
}
