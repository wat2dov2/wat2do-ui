import type { ReactNode } from "react";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { OnboardingProgressDots } from "./OnboardingProgressDots";

interface OnboardingFrameProps {
  currentStep: number;
  totalSteps: number;
  /** The step itself, centred. */
  children: ReactNode;
  /** The goose's dialogue, held at the bottom. */
  dialogue: ReactNode;
}

/**
 * The onboarding page around its steps: progress and language along the top,
 * the step in the middle, the goose's dialogue at the bottom. The page and its
 * loading state both draw it, so one never reflows into the other.
 */
export function OnboardingFrame({ currentStep, totalSteps, children, dialogue }: OnboardingFrameProps) {
  return (
    <main className="h-dvh bg-background flex flex-col overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-30 w-full px-6 pt-4 pb-4 bg-background flex items-center justify-between">
        <OnboardingProgressDots currentStep={currentStep} totalSteps={totalSteps} />
        <div className="flex items-center gap-2">
          <LanguageSelector />
        </div>
      </div>

      {/* Scroll container: the sticky dialogue reserves its own space, so
          tall step content (e.g. the event grid) scrolls above it instead
          of overlapping it. */}
      <div className="flex-1 flex flex-col overflow-y-auto pt-20">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <div className="relative w-full max-w-3xl">{children}</div>
        </div>

        <div className="sticky bottom-0 z-30 px-6 pb-6 pt-4 bg-background">{dialogue}</div>
      </div>
    </main>
  );
}
