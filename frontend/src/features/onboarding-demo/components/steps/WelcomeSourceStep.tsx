import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { DemoSplitLayout } from "../DemoSplitLayout";
import { OnboardingDemoPill, OnboardingDemoPillGroup } from "../OnboardingDemoPill";
import { SOURCE_OPTIONS } from "../../constants";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface WelcomeSourceStepProps {
  flow: OnboardingDemoFlow;
}

export function WelcomeSourceStep({ flow }: WelcomeSourceStepProps) {
  const { t } = useTranslation();

  return (
    <DemoSplitLayout
      left={
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-[11px] tracking-wider uppercase text-muted-foreground font-medium">
              {t("onboardingDemo.source.eyebrow")}
            </p>
            <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
              {t("onboardingDemo.source.title")}
            </h1>
            <p className="text-base text-muted-foreground">{t("onboardingDemo.source.question")}</p>
          </div>
          <OnboardingDemoPillGroup label={t("onboardingDemo.source.groupLabel")}>
            {SOURCE_OPTIONS.map((option) => (
              <OnboardingDemoPill
                key={option}
                label={option}
                selected={flow.state.source === option}
                onClick={() => flow.setSource(option)}
              />
            ))}
          </OnboardingDemoPillGroup>
        </div>
      }
      right={
        <div className="rounded-xl bg-secondary/50 border border-border p-6">
          <p className="text-xs text-muted-foreground mb-4 text-center">
            {t("onboardingDemo.source.previewLabel")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {flow.previewEvents.slice(0, 4).map((event) => (
              <PreviewStyleEventCard key={event.id} event={event} data-event-id={event.id} />
            ))}
          </div>
        </div>
      }
    />
  );
}
