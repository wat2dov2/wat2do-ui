import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";
import { useAuthState } from "@/features/auth";
import type { Event } from "@/shared/types";
import { appendSafeReturnTo, getSafeReturnTo } from "@/features/auth/utils/returnTo";

interface AuthEntryPageProps {
  previewEvents?: Event[];
}

export function AuthEntryPage({ previewEvents = [] }: AuthEntryPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const returnTo = useMemo(
    () => getSafeReturnTo(searchParams.get(QP.RETURN_TO)),
    [searchParams],
  );

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(returnTo ?? ROUTES.HOME);
    }
  }, [isAuthenticated, returnTo, router]);

  const authEntry = useAuthEntryFlow({
    onContinueToOnboarding: (initialSchool) => {
      const onboardingPath = `${ROUTES.ONBOARDING}?${new URLSearchParams({
        [QP.SCHOOL]: initialSchool,
      })}`;
      router.push(appendSafeReturnTo(onboardingPath, returnTo));
    },
    onContinueToHome: (initialSchool) =>
      router.push(
        returnTo ??
        (initialSchool
          ? `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: initialSchool })}`
          : ROUTES.HOME),
      ),
  });

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      description={t("auth.description")}
      previewEvents={previewEvents}
    >
      <AuthEmailFormCard
        email={authEntry.email}
        otpToken={authEntry.otpToken}
        emailSent={authEntry.emailSent}
        onEmailChange={authEntry.onEmailChange}
        onOtpChange={authEntry.onOtpChange}
        onContinue={authEntry.onContinue}
        onResend={authEntry.onResend}
        onSkipToOnboarding={() => router.push(appendSafeReturnTo(ROUTES.ONBOARDING, returnTo))}
        canContinue={authEntry.isFormValid}
        isLoading={authEntry.isLoading}
        error={authEntry.error}
        isEmailPrefilled={authEntry.isEmailPrefilled}
      />
    </AuthPageLayout>
  );
}
