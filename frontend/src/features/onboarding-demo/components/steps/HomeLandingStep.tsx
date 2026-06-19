import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface HomeLandingStepProps {
  flow: OnboardingDemoFlow;
}

export function HomeLandingStep({ flow }: HomeLandingStepProps) {
  const { t } = useTranslation();
  const recommended = flow.matchedEvents.slice(0, 4);
  const saved = flow.interestedEvents;
  const showFreeFood = flow.state.interests.includes("Free food");

  return (
    <div className="w-full space-y-8">
      <div className="space-y-2">
        <Badge variant="outline" className="text-primary border-primary">
          {t("onboardingDemo.home.badge")}
        </Badge>
        <h1 className="font-sans font-semibold text-2xl sm:text-3xl text-foreground leading-tight">
          {t("onboardingDemo.home.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboardingDemo.home.description")}
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("onboardingDemo.home.recommended")}
          </h2>
          <Badge className="bg-primary/10 text-primary border-0 text-[10px]">
            {t("onboardingDemo.home.proTrialBadge")}
          </Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {recommended.map((event) => (
            <PreviewStyleEventCard key={event.id} event={event} data-event-id={event.id} />
          ))}
        </div>
      </section>

      {saved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("onboardingDemo.home.saved")}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {saved.map((event) => (
              <PreviewStyleEventCard key={event.id} event={event} data-event-id={event.id} />
            ))}
          </div>
        </section>
      )}

      {showFreeFood && (
        <section className="rounded-xl border border-border bg-secondary/30 p-4">
          <h2 className="text-sm font-semibold text-foreground mb-1">
            {t("onboardingDemo.home.freeFood")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("onboardingDemo.home.freeFoodPreview")}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            {t("onboardingDemo.challenge.label")}
          </p>
          <p className="text-sm font-medium text-foreground">
            {t("onboardingDemo.challenge.progress", {
              count: flow.challengeProgress,
              total: 3,
            })}
          </p>
        </div>
        <Badge variant="outline">{t("onboardingDemo.home.trialEnds")}</Badge>
      </section>

      <div className="flex justify-center pt-4">
        <Button type="button" variant="outline" onClick={flow.restart}>
          {t("onboardingDemo.actions.restartDemo")}
        </Button>
      </div>
    </div>
  );
}
