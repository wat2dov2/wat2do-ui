import { useTranslation } from "react-i18next";
import { m } from "framer-motion";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { Button } from "@/shared/ui/button";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface CampusRadarPayoffStepProps {
  flow: OnboardingDemoFlow;
}

export function CampusRadarPayoffStep({ flow }: CampusRadarPayoffStepProps) {
  const { t } = useTranslation();
  const matchCount = flow.interestedEvents.length || flow.matchedEvents.length;
  const hasStrongData = flow.state.interests.length > 0 && matchCount > 0;

  return (
    <div className="w-full min-h-[60vh] flex flex-col items-center justify-center rounded-2xl bg-[hsl(0_0%_9%)] text-white px-6 py-12 -mx-2 sm:-mx-4">
      <m.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl space-y-8 text-center"
      >
        <h1 className="font-sans font-semibold text-3xl sm:text-5xl leading-tight">
          {t("onboardingDemo.payoff.title")}
        </h1>

        <div className="space-y-3">
          {hasStrongData ? (
            <>
              <p className="text-2xl sm:text-4xl font-semibold text-primary">
                {t("onboardingDemo.payoff.matched", { count: matchCount })}
              </p>
              <p className="text-lg text-white/70">
                {t("onboardingDemo.payoff.strongestVibe", { vibe: flow.strongestVibe })}
              </p>
              {flow.state.availability.includes("Evenings") ||
              flow.state.availability.includes("Tonight") ? (
                <p className="text-base text-white/60">
                  {t("onboardingDemo.payoff.bestNight")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-2xl sm:text-3xl font-semibold text-primary">
              {t("onboardingDemo.payoff.fallback")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto">
          {(flow.interestedEvents.length > 0 ? flow.interestedEvents : flow.matchedEvents)
            .slice(0, 3)
            .map((event, i) => (
              <m.div
                key={event.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="scale-90 sm:scale-100"
              >
                <PreviewStyleEventCard event={event} data-event-id={event.id} />
              </m.div>
            ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          className="border-white/30 text-white hover:bg-surface-hover"
          onClick={() => flow.goToStep("event_match")}
        >
          {t("onboardingDemo.actions.editPicks")}
        </Button>
      </m.div>
    </div>
  );
}
