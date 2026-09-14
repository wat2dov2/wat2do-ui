import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { ClubCategoryBadge } from "@/shared/components/ClubCategoryBadge";
import { DemoSplitLayout } from "../DemoSplitLayout";
import { OnboardingDemoPill, OnboardingDemoPillGroup } from "../OnboardingDemoPill";
import { INTEREST_OPTIONS } from "../../constants";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface CampusIntentStepProps {
  flow: OnboardingDemoFlow;
}

export function CampusIntentStep({ flow }: CampusIntentStepProps) {
  const { t } = useTranslation();
  const hasPreview = flow.previewEvents.length > 0;

  return (
    <DemoSplitLayout
      left={
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
              {t("onboardingDemo.intent.title")}
            </h1>
            <p className="text-base text-muted-foreground">
              {t("onboardingDemo.intent.description")}
            </p>
          </div>
          <OnboardingDemoPillGroup label={t("onboardingDemo.intent.groupLabel")}>
            {INTEREST_OPTIONS.map((option) => (
              <OnboardingDemoPill
                key={option}
                label={option}
                selected={flow.state.interests.includes(option)}
                onClick={() => flow.toggleInterest(option)}
              />
            ))}
          </OnboardingDemoPillGroup>
        </div>
      }
      right={
        <div className="rounded-xl bg-secondary/50 border border-border p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            {hasPreview
              ? t("onboardingDemo.intent.previewReady")
              : t("onboardingDemo.intent.previewEmpty")}
          </p>
          {hasPreview ? (
            <div className="grid grid-cols-2 gap-3">
              {flow.previewEvents.map((event) => (
                <PreviewStyleEventCard key={event.id} event={event} data-event-id={event.id} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {flow.state.interests.map((interest) => (
                <ClubCategoryBadge key={interest} type={interest} className="rounded-full" />
              ))}
            </div>
          )}
        </div>
      }
    />
  );
}
