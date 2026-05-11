import { useTranslation } from "react-i18next";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { ForgotPasswordFormCard } from "@/features/auth/components/ForgotPasswordFormCard";

export function ForgotPasswordPage() {
  const { t } = useTranslation();

  return (
    <AuthPageLayout
      heading={t("auth.forgotPasswordHeading")}
      description={t("auth.forgotPasswordDescription")}
    >
      <ForgotPasswordFormCard />
    </AuthPageLayout>
  );
}
