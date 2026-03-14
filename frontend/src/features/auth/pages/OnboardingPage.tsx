import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { getSession, updateUserProfile } from "@/features/auth/api/auth.api";
import { removeChecklist } from "@/features/auth/api/checklist.api";
import { useOnboardingFlow } from "@/features/auth/hooks/useOnboardingFlow";
import { OnboardingTopicsStep } from "@/features/auth/components/OnboardingTopicsStep";
import { OnboardingFacultyStep } from "@/features/auth/components/OnboardingFacultyStep";
import { OnboardingYearStep } from "@/features/auth/components/OnboardingYearStep";
import { OnboardingDoneStep } from "@/features/auth/components/OnboardingDoneStep";
import { GooseDialogue } from "@/features/auth/components/GooseDialogue";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { useAppContext } from "@/contexts/AppContext";

const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

function getGooseMessage(step: number, school: string, selectedTopics: string[], faculty: string, isFirstYear: boolean | null): string {
  switch (step) {
    case 0:
      if (selectedTopics.length === 0) {
        if (school) return `Welcome from ${school}! Tap the events that catch your eye — I'll use your picks to build your feed!`;
        return "Honk! Let's get started — tap the events that catch your eye!";
      }
      if (selectedTopics.length === 1) return `${selectedTopics[0]}? Solid pick. Keep going, you can choose more!`;
      return `Ooh, ${selectedTopics.join(", ")} — you've got great taste. Pick more or hit continue!`;
    case 1:
      if (faculty) return `${faculty}! I waddle past that building every day. Let's keep going.`;
      return "Which faculty are you in? I need to know so I can stalk— I mean, recommend the right events.";
    case 2:
      if (isFirstYear === true) return "Welcome to campus! I'll make sure you see all the orientation events and first-year resources.";
      if (isFirstYear === false) return "A veteran, nice! I'll skip the intro stuff and show you the good events right away.";
      return "Last question, I promise! Are you new here? I was new once too... back in 1837.";
    default:
      return "";
  }
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { setProfileCompleted, setUserEmail } = useAppContext();

  const handleComplete = useCallback(
    (data: { school: string; selectedTopics: string[]; faculty: string; isFirstYear: boolean }) => {
      const profile = {
        faculty: data.faculty,
        interests: data.selectedTopics,
        isFirstYear: data.isFirstYear,
        school: data.school,
      };

      // Redirect to events immediately so the user isn't stuck on a slow transition
      navigate("/");
      setProfileCompleted(true);

      const session = getSession();
      setUserEmail(session.email);
      updateUserProfile(profile);
      removeChecklist();

      // Persist to backend in background (fire-and-forget)
      import("@/features/auth/api/auth.api").then(({ updateProfileAPI }) =>
        updateProfileAPI(profile).catch(() => {})
      );
    },
    [navigate, setProfileCompleted, setUserEmail]
  );

  const flow = useOnboardingFlow({ onComplete: handleComplete });

  const isDoneStep = flow.currentStep === 3;

  const gooseMessage = useMemo(
    () => getGooseMessage(flow.currentStep, flow.school, flow.selectedTopics, flow.faculty, flow.isFirstYear),
    [flow.currentStep, flow.school, flow.selectedTopics, flow.faculty, flow.isFirstYear]
  );

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="w-full px-6 pt-4 flex justify-end">
        <div className="flex items-center gap-2">
          <LanguageSelector />
          <AnimatedThemeToggler />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-6">
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
              {flow.currentStep === 0 && (
                <OnboardingTopicsStep
                  selectedTopics={flow.selectedTopics}
                  onToggleTopic={flow.toggleTopic}
                />
              )}

              {flow.currentStep === 1 && (
                <OnboardingFacultyStep
                  faculty={flow.faculty}
                  onFacultyChange={flow.setFaculty}
                />
              )}

              {flow.currentStep === 2 && (
                <OnboardingYearStep
                  isFirstYear={flow.isFirstYear}
                  onSelectYear={flow.setIsFirstYear}
                />
              )}

              {isDoneStep && (
                <OnboardingDoneStep onFinish={flow.goNext} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {!isDoneStep && (
          <GooseDialogue
            message={gooseMessage}
            onBack={flow.goBack}
            onNext={flow.goNext}
            nextDisabled={!flow.canContinue}
            showBack={flow.currentStep > 0}
            nextLabel="Continue"
          />
        )}
      </div>
    </main>
  );
}
