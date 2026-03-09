/**
 * Progress bar component for onboarding steps
 */

import { Progress } from "@/shared/ui/progress";
import { useTranslation } from "react-i18next";

interface OnboardingProgressProps {
  currentStep: number;
  visibleSteps: number;
  displayStep: number;
}

export function OnboardingProgress({
  currentStep,
  visibleSteps,
  displayStep,
}: OnboardingProgressProps) {
  const { t } = useTranslation();
  const progressValue =
    currentStep === 0
      ? 0
      : currentStep >= 4
        ? 100
        : (displayStep / visibleSteps) * 100;

  if (currentStep < 1 || currentStep > 3) {
    return null;
  }

  return (
    <div style={{ marginRight: 24 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {t("modals.onboarding.stepProgress", { step: displayStep, total: visibleSteps })}
        </span>
        <span className="text-xs text-muted-foreground">{Math.round(progressValue)}%</span>
      </div>
      <Progress value={progressValue} className="h-1" />
    </div>
  );
}
