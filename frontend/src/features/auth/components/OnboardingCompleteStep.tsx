/**
 * Completion step component for onboarding
 */

import { Check, Sparkles } from "lucide-react";
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { useTranslation } from "react-i18next";
import { translateInterest } from "@/shared/utils/translateInterest";

interface OnboardingCompleteStepProps {
  emailUsername?: string;
  selectedFaculty?: string;
  isFirstYear: boolean | null;
  selectedInterests: string[];
  onNext: () => void;
}

export function OnboardingCompleteStep({
  emailUsername,
  selectedFaculty,
  isFirstYear,
  selectedInterests,
  onNext,
}: OnboardingCompleteStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-4">
        <div className="size-16 rounded-full bg-success flex items-center justify-center">
          <Check className="size-8 text-white" strokeWidth={3} />
        </div>
        <div className="absolute -top-1 -right-1 size-6 bg-yellow-400 rounded-full flex items-center justify-center">
          <Sparkles className="size-3 text-white" />
        </div>
      </div>

      <DialogHeader className="space-y-2 mb-6 text-center">
        <DialogTitle className="text-xl text-center">{t("modals.allSet.title")}</DialogTitle>
        <DialogDescription className="text-center">
          {t("modals.allSet.description")}
        </DialogDescription>
      </DialogHeader>

      {(emailUsername || selectedFaculty || selectedInterests.length > 0) && (
        <div className="w-full rounded-xl p-4 mb-6 text-left text-sm bg-secondary">
          {emailUsername && (
            <p className="mb-1 text-foreground">
              <span className="text-muted-foreground">{t("settings.profile.email")}:</span>{" "}
              {emailUsername}@gmail.com
            </p>
          )}
          {selectedFaculty && (
            <p className="mb-1 text-foreground">
              <span className="text-muted-foreground">{t("settings.profile.faculty")}:</span>{" "}
              {selectedFaculty}
            </p>
          )}
          {isFirstYear !== null && (
            <p className="mb-1 text-foreground">
              <span className="text-muted-foreground">{t("modals.allSet.year")}:</span>{" "}
              {isFirstYear ? t("modals.allSet.firstYear") : t("modals.allSet.returningStudent")}
            </p>
          )}
          {selectedInterests.length > 0 && (
            <p className="text-foreground">
              <span className="text-muted-foreground">{t("modals.allSet.interests")}:</span>{" "}
              {selectedInterests.map((interest) => translateInterest(interest, t)).join(", ")}
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button onClick={onNext} className="w-full">
          {t("modals.allSet.startExploring")}
        </Button>
      </DialogFooter>
    </div>
  );
}
