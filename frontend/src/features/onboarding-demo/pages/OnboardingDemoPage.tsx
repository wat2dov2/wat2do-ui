import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { Button } from "@/shared/ui/button";
import { OnboardingDemoProgress } from "../components/OnboardingDemoProgress";
import { OnboardingDemoFooter } from "../components/OnboardingDemoFooter";
import { useOnboardingDemoFlow } from "../hooks/useOnboardingDemoFlow";
import { WelcomeSourceStep } from "../components/steps/WelcomeSourceStep";
import { CampusIntentStep } from "../components/steps/CampusIntentStep";
import { AvailabilitySocialStep } from "../components/steps/AvailabilitySocialStep";
import { EventMatchStep } from "../components/steps/EventMatchStep";
import { CampusRadarPayoffStep } from "../components/steps/CampusRadarPayoffStep";
import { BuildMyWeekStep } from "../components/steps/BuildMyWeekStep";
import { ProUnlockStep } from "../components/steps/ProUnlockStep";
import { ProChallengeStep } from "../components/steps/ProChallengeStep";
import { HomeLandingStep } from "../components/steps/HomeLandingStep";

// Steps overlap: the next one arrives while the last one leaves (popLayout),
// easing out on the way in and leaving 20% faster, easing in.
const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.24, ease: "easeIn" } },
} as const;

const NEXT_LABEL_KEYS: Record<string, string> = {
  build_week: "onboardingDemo.actions.showMyWeek",
  pro_unlock: "onboardingDemo.actions.great",
  pro_challenge: "onboardingDemo.actions.finish",
  home: "onboardingDemo.actions.done",
};

export function OnboardingDemoPage() {
  const { t } = useTranslation();
  const flow = useOnboardingDemoFlow();

  const handleNext = useCallback(() => {
    if (flow.currentStep === "pro_unlock") {
      flow.acceptProTrial();
    }
    flow.goNext();
  }, [flow]);

  const nextLabel = t(NEXT_LABEL_KEYS[flow.currentStep] ?? "onboardingDemo.actions.continue");
  const isHome = flow.currentStep === "home";
  const isPayoff = flow.currentStep === "radar_payoff";

  const stepContent = useMemo(() => {
    switch (flow.currentStep) {
      case "welcome":
        return <WelcomeSourceStep flow={flow} />;
      case "campus_intent":
        return <CampusIntentStep flow={flow} />;
      case "availability":
        return <AvailabilitySocialStep flow={flow} />;
      case "event_match":
        return <EventMatchStep flow={flow} />;
      case "radar_payoff":
        return <CampusRadarPayoffStep flow={flow} />;
      case "build_week":
        return <BuildMyWeekStep flow={flow} />;
      case "pro_unlock":
        return <ProUnlockStep />;
      case "pro_challenge":
        return <ProChallengeStep flow={flow} />;
      case "home":
        return <HomeLandingStep flow={flow} />;
    }
  }, [flow]);

  return (
    <LazyMotion features={domAnimation} strict>
      {/* The viewport is the frame: header and footer stay put and only the step
          scrolls, so a tall step never slides under the footer. */}
      <main className="h-dvh bg-background flex flex-col">
      <header className="sticky top-0 z-10 w-full px-4 sm:px-6 pt-4 pb-3 bg-background border-b border-border">
        <div className="flex items-center justify-between gap-4 max-w-6xl mx-auto">
          <OnboardingDemoProgress currentStep={flow.currentStep} />
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline text-[10px] text-muted-foreground">
              {t("onboardingDemo.chrome.demo")}
            </span>
            <LanguageSelector />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-6 sm:py-8 overflow-y-auto">
        <div className="relative w-full max-w-6xl mx-auto flex-1 flex flex-col justify-center min-h-0">
          <AnimatePresence mode="popLayout">
            <m.div
              key={flow.currentStep}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="w-full"
            >
              {stepContent}
            </m.div>
          </AnimatePresence>
        </div>
      </div>

      {!isHome && (
        <footer className="sticky bottom-0 px-4 sm:px-6 py-4 bg-background border-t border-border">
          <div className="max-w-6xl mx-auto">
            {isPayoff ? (
              <div className="flex justify-end">
                <Button type="button" onClick={handleNext}>
                  {t("onboardingDemo.actions.continue")}
                </Button>
              </div>
            ) : (
              <OnboardingDemoFooter
                onBack={flow.goBack}
                onNext={handleNext}
                nextLabel={nextLabel}
                nextDisabled={!flow.canContinue}
                showBack={flow.stepIndex > 0}
              />
            )}
          </div>
        </footer>
      )}
      </main>
    </LazyMotion>
  );
}
