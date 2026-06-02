import { createSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";

export function AuthEntryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

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
    onForgotPassword: () => navigate(ROUTES.FORGOT_PASSWORD),
  });

  const isSignup = authEntry.authMode === "signup";

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      description={isSignup ? t("auth.signupDescription") : t("auth.loginDescription")}
    >
      <AuthEmailFormCard
        email={authEntry.email}
        password={authEntry.password}
        authMode={authEntry.authMode}
        onEmailChange={authEntry.onEmailChange}
        onPasswordChange={authEntry.onPasswordChange}
        onContinue={authEntry.onContinue}
        onToggleMode={authEntry.toggleAuthMode}
        onForgotPassword={authEntry.onForgotPassword}
        canContinue={authEntry.isFormValid}
        isLoading={authEntry.isLoading}
        error={authEntry.error}
        confirmationMessage={authEntry.confirmationMessage}
        isEmailPrefilled={authEntry.isEmailPrefilled}
      />

    </AuthPageLayout>
  );
}
