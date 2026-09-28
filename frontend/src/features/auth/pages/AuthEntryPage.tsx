"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import {
  appendSafeReturnTo,
  getSafeReturnTo,
} from "@/features/auth/utils/returnTo";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { GoogleSignInButton } from "@/features/auth/components/GoogleSignInButton";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { Button } from "@/shared/ui/button";

interface AuthEntryPageProps {
  preview: ReactNode;
  initialEmail?: string;
  invitationToken?: string;
  initialReturnTo?: string;
  initialOAuthError?: string;
}

export function AuthEntryPage({
  preview,
  initialEmail,
  invitationToken,
  initialReturnTo,
  initialOAuthError,
}: AuthEntryPageProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const returnTo = useMemo(
    () => getSafeReturnTo(initialReturnTo),
    [initialReturnTo],
  );

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(returnTo ?? ROUTES.HOME);
    }
  }, [isAuthenticated, returnTo, router]);

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      description={t("auth.description")}
      preview={preview}
    >
      <GoogleSignInButton
        returnTo={returnTo ?? undefined}
        hasError={initialOAuthError === "google"}
      />
      <EmailOtpForm
        className="mt-4"
        initialEmail={initialEmail}
        invitationToken={invitationToken}
        returnTo={returnTo ?? undefined}
        isEmailLocked={Boolean(invitationToken)}
        onAuthenticated={(session) => {
          if (session.onboardingRequired) {
            const onboardingPath = `${ROUTES.ONBOARDING}?${new URLSearchParams({
              [QP.SCHOOL]: session.school,
            })}`;
            router.push(appendSafeReturnTo(onboardingPath, returnTo));
            return;
          }

          router.push(
            returnTo ??
              `${ROUTES.HOME}?${new URLSearchParams({
                [QP.SCHOOL]: session.school,
              })}`,
          );
        }}
        requestFooter={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              router.push(appendSafeReturnTo(ROUTES.ONBOARDING, returnTo))
            }
            className="w-full"
          >
            {t("auth.skipToOnboarding")}
          </Button>
        }
      />
    </AuthPageLayout>
  );
}
