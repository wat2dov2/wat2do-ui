import { useEffect } from "react";
import { createSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";
import { useAuthState } from "@/features/auth";

export function AuthEntryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();

  useEffect(() => {
    if (isAuthenticated) {
      navigate(ROUTES.HOME, { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const authEntry = useAuthEntryFlow({
    onContinueToOnboarding: (initialSchool) =>
      navigate(ROUTES.ONBOARDING, { state: { school: initialSchool } }),
    onContinueToHome: (initialSchool) =>
      navigate(
        initialSchool
          ? {
              pathname: ROUTES.HOME,
              search: `?${createSearchParams({ [QP.SCHOOL]: initialSchool })}`,
            }
          : ROUTES.HOME,
      ),
  });

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      description={t("auth.description")}
    >
      <AuthEmailFormCard
        email={authEntry.email}
        otpToken={authEntry.otpToken}
        emailSent={authEntry.emailSent}
        onEmailChange={authEntry.onEmailChange}
        onOtpChange={authEntry.onOtpChange}
        onContinue={authEntry.onContinue}
        onResend={authEntry.onResend}
        canContinue={authEntry.isFormValid}
        isLoading={authEntry.isLoading}
        error={authEntry.error}
        isEmailPrefilled={authEntry.isEmailPrefilled}
      />
    </AuthPageLayout>
  );
}
