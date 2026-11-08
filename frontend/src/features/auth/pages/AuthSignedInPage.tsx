import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { announceSignedIn } from "@/features/auth/api/googleWindow";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";

/**
 * The last page of a sign-in that ran in a window of its own: it tells the
 * page that opened the window, which carries on signed in, then closes. A
 * browser that will not let it close leaves this note instead.
 */
export function AuthSignedInPage() {
  const { t } = useTranslation();

  useEffect(() => {
    announceSignedIn();
    window.close();
  }, []);

  return (
    <AuthPageLayout
      heading={t("auth.signedInHeading")}
      description={t("auth.signedInDescription")}
    />
  );
}
