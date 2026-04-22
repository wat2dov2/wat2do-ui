import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";

export function AuthEntryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const authEntry = useAuthEntryFlow({
    onContinueToOnboarding: (initialSchool) =>
      navigate(ROUTES.ONBOARDING, { state: { school: initialSchool } }),
    onContinueToHome: () => navigate(ROUTES.HOME),
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <div className="w-full max-w-[420px] space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] tracking-wider uppercase text-muted-foreground">
                {t("auth.tagline")}
              </p>
              <h1 className="font-sans font-bold text-[32px] text-foreground leading-tight">
                {t("auth.heading")}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {authEntry.authMode === "signup"
                  ? t("auth.signupDescription")
                  : t("auth.loginDescription")}
              </p>
            </div>

            <AuthEmailFormCard
              email={authEntry.email}
              password={authEntry.password}
              authMode={authEntry.authMode}
              onEmailChange={authEntry.onEmailChange}
              onPasswordChange={authEntry.onPasswordChange}
              onContinue={authEntry.onContinue}
              onToggleMode={authEntry.toggleAuthMode}
              canContinue={authEntry.isFormValid}
              isLoading={authEntry.isLoading}
              error={authEntry.error}
            />
          </div>
        </section>

        <AuthHeroPanel />
      </div>
    </main>
  );
}
