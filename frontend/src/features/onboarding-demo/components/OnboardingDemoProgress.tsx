import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { PROGRESS_SEGMENTS } from "../constants";
import type { OnboardingDemoStep } from "../types";

interface OnboardingDemoProgressProps {
  currentStep: OnboardingDemoStep;
}

export function OnboardingDemoProgress({ currentStep }: OnboardingDemoProgressProps) {
  const { t } = useTranslation();
  const activeSegmentIndex = PROGRESS_SEGMENTS.findIndex((seg) =>
    seg.steps.includes(currentStep)
  );

  return (
    <nav aria-label={t("onboardingDemo.progress.label")} className="flex items-center gap-2 w-full max-w-md">
      {PROGRESS_SEGMENTS.map((segment, index) => {
        const isActive = index === activeSegmentIndex;
        const isComplete = index < activeSegmentIndex;

        return (
          <div key={segment.id} className="flex-1 flex flex-col gap-1.5 min-w-0">
            <div
              className={cn(
                "h-1 rounded-full transition-colors duration-300",
                isComplete || isActive ? "bg-primary" : "bg-muted"
              )}
              aria-hidden
            />
            <span
              className={cn(
                "text-[10px] font-medium truncate",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              {t(`onboardingDemo.progress.${segment.id}`)}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
