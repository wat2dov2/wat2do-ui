import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { DemoSplitLayout } from "../DemoSplitLayout";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface BuildMyWeekStepProps {
  flow: OnboardingDemoFlow;
}

export function BuildMyWeekStep({ flow }: BuildMyWeekStepProps) {
  const { t } = useTranslation();
  const interestedCount = flow.interestedEvents.length;
  const weekMatches = flow.matchedEvents.length;
  const hasPicks = interestedCount > 0;

  return (
    <DemoSplitLayout
      left={
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
              {t("onboardingDemo.buildWeek.title")}
            </h1>
            <p className="text-base text-muted-foreground">
              {hasPicks
                ? t("onboardingDemo.buildWeek.descriptionWithPicks")
                : t("onboardingDemo.buildWeek.descriptionWithoutPicks")}
            </p>
          </div>
        </div>
      }
      right={
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <div className="space-y-4">
            <div className="flex justify-between items-start border-b border-border pb-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("onboardingDemo.buildWeek.tonight")}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {hasPicks
                    ? t("onboardingDemo.buildWeek.tonightWithPick")
                    : t("onboardingDemo.buildWeek.tonightWithoutPick")}
                </p>
              </div>
            </div>
            <div className="flex justify-between items-start border-b border-border pb-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("onboardingDemo.buildWeek.thisWeek")}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {t("onboardingDemo.buildWeek.weekMatches", { count: weekMatches })}
                </p>
              </div>
            </div>
            <div className="flex justify-between items-start border-b border-border pb-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("onboardingDemo.buildWeek.clubsToFollow")}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {t("onboardingDemo.buildWeek.clubSuggestions")}
                </p>
              </div>
            </div>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("onboardingDemo.buildWeek.freeFoodAlerts")}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {flow.state.interests.includes("Free food")
                    ? t("onboardingDemo.buildWeek.on")
                    : t("onboardingDemo.buildWeek.off")}
                </p>
              </div>
            </div>
          </div>

          {hasPicks && (
            <div className="grid grid-cols-2 gap-2 pt-2">
              {flow.interestedEvents.slice(0, 2).map((event) => (
                <PreviewStyleEventCard key={event.id} event={event} data-event-id={event.id} />
              ))}
            </div>
          )}
        </div>
      }
    />
  );
}
