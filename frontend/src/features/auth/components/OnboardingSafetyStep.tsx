import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface OnboardingSafetyStepProps {
  onContinue: () => void;
}

export function OnboardingSafetyStep({ onContinue }: OnboardingSafetyStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center text-center gap-y-6 max-w-lg mx-auto">
      <span className="text-3xl leading-none text-primary">✶</span>
      <h1 className="font-sans font-semibold text-[28px] leading-tight text-foreground">
        {t("onboarding.safetyTitle")}
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("onboarding.safetyDescription")}
      </p>

      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed text-left w-full">
        <p>{t("onboarding.safetySaveEvents")}</p>
        <p>{t("onboarding.safetySafeguards")}</p>
      </div>

      <Button type="button" onClick={onContinue}>
        {t("common.continue")}
      </Button>
    </div>
  );
}
