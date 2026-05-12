/**
 * Welcome step component for onboarding
 */

import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { GOOSE_IMAGE_URL } from "@/shared/constants/images";
import { useTranslation } from "react-i18next";

interface OnboardingWelcomeStepProps {
  onNext: () => void;
}

export function OnboardingWelcomeStep({ onNext }: OnboardingWelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="size-24 rounded-full overflow-hidden mb-4 bg-secondary">
        <img
          src={GOOSE_IMAGE_URL}
          alt="Goose mascot"
          className="w-full h-full object-cover"
        />
      </div>

      <DialogHeader className="space-y-2 mb-6 text-center">
        <DialogTitle className="text-xl text-center">{t("modals.welcome.title")}</DialogTitle>
        <DialogDescription className="text-center">
          {t("modals.welcome.description")}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button onClick={onNext} className="w-full">
          {t("modals.getStarted")}
        </Button>
      </DialogFooter>
    </div>
  );
}
