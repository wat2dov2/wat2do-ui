import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { verifyOtpAPI } from "@/features/auth/api/auth.api";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { Spinner } from "@/shared/ui/spinner";
import { Button } from "@/shared/ui/button";

export function AuthCallbackPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const token = searchParams.get("token");
  const email = searchParams.get("email");

  useEffect(() => {
    let active = true;

    async function performHandshake() {
      if (!token || !email) {
        if (active) {
          setError(t("auth.resetPasswordInvalidLink"));
          setIsLoading(false);
        }
        return;
      }

      try {
        const result = await verifyOtpAPI(email, token);
        if (!active) return;

        const school = result.school || DEFAULT_SCHOOL;

        if (result.onboardingRequired) {
          router.replace(`${ROUTES.ONBOARDING}?${new URLSearchParams({ [QP.SCHOOL]: school })}`);
        } else {
          router.replace(
            school
              ? `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: school })}`
              : ROUTES.HOME,
          );
        }
      } catch (err) {
        console.error("Auth callback verification failed:", err);
        if (active) {
          setError(t("auth.resetPasswordInvalidLink"));
          setIsLoading(false);
        }
      }
    }

    performHandshake();

    return () => {
      active = false;
    };
  }, [token, email, router, t]);

  return (
    <AuthPageLayout
      heading={t("auth.heading")}
      description={error ? t("auth.genericError") : t("common.pleaseWait")}
    >
      <div className="w-full flex flex-col items-center justify-center py-8 space-y-4">
        {isLoading ? (
          <>
            <Spinner className="size-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">{t("common.pleaseWait")}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-destructive text-center max-w-xs">{error}</p>
            <Button
              type="button"
              onMouseDown={() => router.replace(ROUTES.LOGIN)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;

                e.preventDefault();
                router.replace(ROUTES.LOGIN);
              }}
              className="w-full mt-4"
            >
              {t("auth.backToLogin")}
            </Button>
          </>
        )}
      </div>
    </AuthPageLayout>
  );
}
