import { useTranslation } from "react-i18next";
import { DemoSplitLayout } from "../DemoSplitLayout";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface ProChallengeStepProps {
  flow: OnboardingDemoFlow;
}

export function ProChallengeStep({ flow }: ProChallengeStepProps) {
  const { t } = useTranslation();
  const progress = flow.challengeProgress;
  const total = 3;

  return (
    <DemoSplitLayout
      left={
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
              {t("onboardingDemo.challenge.title")}
            </h1>
            <p className="text-base text-muted-foreground">
              {t("onboardingDemo.challenge.description")}
            </p>
          </div>
        </div>
      }
      right={
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("onboardingDemo.challenge.label")}
            </p>
            <p className="text-lg font-semibold text-foreground">
              {t("onboardingDemo.challenge.progress", { count: progress, total })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("onboardingDemo.challenge.reward")}
            </p>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              // A full-width fill slides in from the bar's start (the right in a right-to-left
              // page) instead of growing, so it moves without the page laying out again.
              className="h-full w-full bg-primary rounded-full transition-transform duration-300 [--fill-from:-1] rtl:[--fill-from:1]"
              style={{ translate: `calc(var(--fill-from) * ${100 - Math.min((progress / total) * 100, 100)}%) 0` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={t("onboardingDemo.challenge.progressAria")}
            />
          </div>
          {progress > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("onboardingDemo.challenge.markedInterested", { count: progress })}
            </p>
          )}
        </div>
      }
    />
  );
}
