import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { DemoSplitLayout } from "../DemoSplitLayout";
import { OnboardingDemoPill, OnboardingDemoPillGroup } from "../OnboardingDemoPill";
import { AVAILABILITY_OPTIONS, SOCIAL_OPTIONS } from "../../constants";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface AvailabilitySocialStepProps {
  flow: OnboardingDemoFlow;
}

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AvailabilitySocialStep({ flow }: AvailabilitySocialStepProps) {
  const { t } = useTranslation();
  const hasEvenings = flow.state.availability.some(
    (a) => a === "Evenings" || a === "Tonight" || a === "Weekends"
  );
  const hasWeekdays = flow.state.availability.some(
    (a) => a === "Weekdays after class" || a === "Lunch breaks"
  );

  return (
    <DemoSplitLayout
      left={
        <div className="space-y-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
                {t("onboardingDemo.availability.title")}
              </h1>
              <p className="text-base text-muted-foreground">
                {t("onboardingDemo.availability.description")}
              </p>
            </div>
            <OnboardingDemoPillGroup label={t("onboardingDemo.availability.groupLabel")}>
              {AVAILABILITY_OPTIONS.map((option) => (
                <OnboardingDemoPill
                  key={option}
                  label={option}
                  selected={flow.state.availability.includes(option)}
                  onClick={() => flow.toggleAvailability(option)}
                />
              ))}
            </OnboardingDemoPillGroup>
          </div>

          <div className="space-y-4">
            <h2 className="font-semibold text-lg text-foreground">{t("onboardingDemo.availability.socialTitle")}</h2>
            <OnboardingDemoPillGroup label={t("onboardingDemo.availability.socialGroupLabel")}>
              {SOCIAL_OPTIONS.map((option) => (
                <OnboardingDemoPill
                  key={option.value}
                  label={option.label}
                  selected={flow.state.socialMode === option.value}
                  onClick={() => flow.setSocialMode(option.value)}
                />
              ))}
            </OnboardingDemoPillGroup>
          </div>
        </div>
      }
      right={
        <div className="rounded-xl bg-secondary/50 border border-border p-6">
          <p className="text-sm text-muted-foreground mb-4">{t("onboardingDemo.availability.weekPreviewTitle")}</p>
          <div className="flex gap-2">
            {WEEK_DAYS.map((day, i) => {
              const isWeekend = i >= 5;
              const isActive =
                flow.state.availability.length === 0
                  ? false
                  : flow.state.availability.includes("I am flexible") ||
                    (isWeekend && hasEvenings) ||
                    (!isWeekend && hasWeekdays) ||
                    (day === "Thu" && hasEvenings);

              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{day}</span>
                  <div
                    className={cn(
                      "w-full h-16 rounded-lg border transition-colors",
                      isActive
                        ? "bg-primary/15 border-primary/40"
                        : "bg-muted/50 border-border"
                    )}
                  />
                </div>
              );
            })}
          </div>
          {flow.state.availability.length === 0 && (
            <p className="text-xs text-muted-foreground mt-4 text-center">
              {t("onboardingDemo.availability.emptyWeek")}
            </p>
          )}
        </div>
      }
    />
  );
}
