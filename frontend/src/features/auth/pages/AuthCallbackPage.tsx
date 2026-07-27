import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { verifyOtpAPI } from "@/features/auth/api/auth.api";
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

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(false);

  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const returnTo = getSafeReturnTo(searchParams.get(QP.RETURN_TO));
  const hasValidParams = Boolean(token && email);

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

      if (result.onboardingRequired) {
        const onboardingPath = `${ROUTES.ONBOARDING}?${new URLSearchParams({
          [QP.SCHOOL]: school,
        })}`;
        router.replace(appendSafeReturnTo(onboardingPath, returnTo));
      } else {
        router.replace(
          returnTo ??
          (school
            ? `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: school })}`
            : ROUTES.HOME),
        );
      }
    } catch (err) {
      console.error("Auth callback verification failed:", err);
      verifyingTokens.delete(key);
      setError(t("auth.resetPasswordInvalidLink"));
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
          : hasValidParams
            ? t("auth.callbackDescription", { email })
            : t("auth.resetPasswordInvalidLink")
      }
    >
      <div className="w-full flex flex-col items-center justify-center py-8 space-y-4">
        {error || !hasValidParams ? (
          <p className="text-sm text-destructive text-center max-w-xs">
            {error || t("auth.resetPasswordInvalidLink")}
          </p>
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
