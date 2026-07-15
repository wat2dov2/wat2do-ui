import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";
import { useAuthState } from "@/features/auth";
import type { Event } from "@/shared/types";

interface AuthEntryPageProps {
  previewEvents?: Event[];
}

export function AuthEntryPage({ previewEvents = [] }: AuthEntryPageProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(ROUTES.HOME);
    }
  }, [isAuthenticated, router]);

  const authEntry = useAuthEntryFlow({
    onContinueToOnboarding: (initialSchool) =>
      router.push(`${ROUTES.ONBOARDING}?${new URLSearchParams({ [QP.SCHOOL]: initialSchool })}`),
    onContinueToHome: (initialSchool) =>
      router.push(
        initialSchool
          ? `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: initialSchool })}`
          : ROUTES.HOME,
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
        onSkipToOnboarding={() => router.push(ROUTES.ONBOARDING)}
        canContinue={authEntry.isFormValid}
        isLoading={authEntry.isLoading}
        error={authEntry.error}
        isEmailPrefilled={authEntry.isEmailPrefilled}
      />
    </AuthPageLayout>
  );
}
