/**
 * Progress indicator for onboarding: small circles;
 * grey = not done, filled primary = done.
 */

import { cn } from "@/shared/lib/utils";

interface OnboardingProgressDotsProps {
  currentStep: number;
  totalSteps: number;
  className?: string;
}

export function OnboardingProgressDots({
  currentStep,
  totalSteps,
  className,
}: OnboardingProgressDotsProps) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2", className)}
      role="progressbar"
      aria-valuenow={currentStep + 1}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-label={`Onboarding step ${currentStep + 1} of ${totalSteps}`}
    >
      {Array.from({ length: totalSteps }, (_, i) => {
        const done = i <= currentStep;
        return (
          <span
            key={i}
            className={cn(
              "rounded-full transition-colors",
              "w-2 h-2",
              done ? "bg-primary" : "bg-muted"
            )}
          />
        );
      })}
    </div>
  );
}
