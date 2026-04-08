import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { AnimatePresence, motion } from "framer-motion";
import { getSession, updateUserProfile } from "@/features/auth/api/auth.api";
import { useOnboardingFlow } from "@/features/auth/hooks/useOnboardingFlow";
import { OnboardingEventGrid } from "@/features/auth/components/OnboardingEventGrid";
import { OnboardingInterestsCombobox } from "@/features/auth/components/OnboardingInterestsCombobox";
import { OnboardingFacultyStep } from "@/features/auth/components/OnboardingFacultyStep";
import { GooseDialogue } from "@/features/auth/components/GooseDialogue";
import { OnboardingProgressDots } from "@/features/auth/components/OnboardingProgressDots";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { useUserContext } from "@/contexts/UserContext";

const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

function getGooseMessage(step: number, school: string): string {
  switch (step) {
    case 0:
      return "Hey there!";
    case 1:
      return "Welcome to the Wat2Do family! We're a collective with 1 goal: to create as many memories as possible in our short time in university";
    case 2:
      return "Everyone here is into something different. What kind of events are you into?";
    case 3:
      if (school) return `5 other students have the exact same interests! Now, which of these from ${school} catch your eye?`;
      return "Love it, this is how we find the good stuff. Which of these catch your eye?";
    case 4:
      return "Gotcha, and which faculty are you in?";
    case 5:
      return "Ding! Your personalized feed is hot, fresh, and ready to serve!";
    default:
      return "";
  }
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { setProfileCompleted, setUserEmail } = useUserContext();

  const handleComplete = useCallback(
    (data: {
      school: string;
      selectedTopics: string[];
      selectedEventIds: number[];
      faculty: string;
      isFirstYear: boolean;
    }) => {
      const profile = {
        faculty: data.faculty,
        interests: data.selectedTopics,
        isFirstYear: data.isFirstYear,
        school: data.school,
        role: "user" as const,
        hasClub: false,
      };

      // Redirect to events immediately so the user isn't stuck on a slow transition
      navigate(ROUTES.HOME);
      setProfileCompleted(true);

      const session = getSession();
      setUserEmail(session.email);
      updateUserProfile(profile);

      // Persist to backend in background (fire-and-forget)
      import("@/features/auth/api/auth.api").then(({ updateProfileAPI }) =>
        updateProfileAPI(profile).catch((err) => console.error("Failed to persist onboarding profile:", err))
      );
    },
    [navigate, setProfileCompleted, setUserEmail]
  );

  const flow = useOnboardingFlow({ onComplete: handleComplete });

  const isDoneStep = flow.currentStep === 5;

  const gooseMessage = useMemo(
    () => getGooseMessage(flow.currentStep, flow.school),
    [flow.currentStep, flow.school]
  );

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-10 w-full px-6 pt-4 pb-4 bg-background flex items-center justify-between">
        <OnboardingProgressDots
          currentStep={flow.currentStep}
          totalSteps={flow.totalSteps}
        />
        <div className="flex items-center gap-2">
          <LanguageSelector />
          <AnimatedThemeToggler />
        </div>
      </div>

      {/* Extra bottom padding so content never overlaps the fixed dialogue */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-20 py-8 pb-[220px]">
        <div className="w-full max-w-3xl flex-1 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={flow.currentStep}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="w-full"
            >
              {/* Steps 0 & 1: dialogue only — no form content */}
              {(flow.currentStep === 0 || flow.currentStep === 1) && (
                <div className="w-full min-h-[120px]" aria-hidden />
              )}

              {flow.currentStep === 2 && (
                <OnboardingInterestsCombobox
                  selected={flow.selectedTopics}
                  onToggle={flow.toggleTopic}
                  placeholder="Search or select event types..."
                />
              )}

              {flow.currentStep === 3 && (
                <OnboardingEventGrid
                  selectedEventIds={flow.selectedEventIds}
                  onToggleEventId={flow.toggleEventId}
                />
              )}

              {flow.currentStep === 4 && (
                <OnboardingFacultyStep
                  faculty={flow.faculty}
                  onFacultyChange={flow.setFaculty}
                />
              )}

              {/* Step 5: done — message and CTA are in the goose dialogue only */}
              {isDoneStep && <div className="w-full min-h-[120px]" aria-hidden />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-6 pb-6 pt-4 bg-background">
        <GooseDialogue
          message={gooseMessage}
          onBack={flow.goBack}
          onNext={flow.goNext}
          nextDisabled={!flow.canContinue}
          showBack={flow.currentStep > 0}
          nextLabel={isDoneStep ? "Take me to Wat2Do!" : "Continue"}
        />
      </div>
    </main>
  );
}
