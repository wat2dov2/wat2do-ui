import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AnimatePresence, m } from "framer-motion";
import { Mail } from "@/shared/ui/doodle-icons";
import { useOnboardingFlow } from "../hooks/useOnboardingFlow";
import { useUpdateProfile } from "../hooks/useUpdateProfile";
import { getUserId } from "@/features/auth";
import { setDailyNewEventsEmailPreferenceAPI } from "@/features/settings/api/notificationPreferences.api";
import { OnboardingEventGrid } from "../components/OnboardingEventGrid";
import { OnboardingFacultyStep } from "../components/OnboardingFacultyStep";
import { GooseDialogue } from "../components/GooseDialogue";
import { OnboardingProgressDots } from "../components/OnboardingProgressDots";
import { OnboardingYearStep } from "../components/OnboardingYearStep";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { MultiSelect } from "@/shared/ui/multi-select";
import { getEventCategories } from "@/shared/data/eventCategories";
import { Switch } from "@/shared/ui/switch";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { translateSchool } from "@/shared/utils/schoolTranslation";

const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

const GOOSE_MESSAGE_KEYS: Record<number, string> = {
  0: "onboarding.gooseStep0",
  1: "onboarding.gooseStep1",
  2: "onboarding.gooseStep2",
  4: "onboarding.gooseStep4",
  5: "onboarding.gooseStep5",
};

interface OnboardingEmailOptInStepProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function OnboardingEmailOptInStep({
  checked,
  onCheckedChange,
}: OnboardingEmailOptInStepProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <Mail className="size-4 text-foreground" />
          </div>
          <div className="space-y-1 min-w-0">
            <label htmlFor="daily-new-events-opt-in" className="text-sm font-semibold text-foreground">
              {t("onboarding.emailDigestTitle")}
            </label>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("onboarding.emailDigestDescription")}
            </p>
          </div>
        </div>
        <Switch
          id="daily-new-events-opt-in"
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={t("onboarding.emailDigestTitle")}
        />
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { persistProfile } = useUpdateProfile();

  // Signup flow hands the school over via the URL so a refresh preserves the
  // institution-specific onboarding greeting.
  const initialSchool = useMemo(() => {
    return searchParams.get(QP.SCHOOL) ?? "";
  }, [searchParams]);

  const handleComplete = useCallback(
    (data: {
      school: string;
      selectedTopics: string[];
      selectedEventIds: number[];
      faculty: string;
      isFirstYear: boolean;
      dailyNewEventsOptIn: boolean;
    }) => {
      const homeWithSchool = `${ROUTES.HOME}?${new URLSearchParams({ [QP.SCHOOL]: data.school })}`;

      // Anonymous preview (reached via the "continue without signing in" path):
      // there is no account to attach preferences to, so send them straight to
      // their school feed instead of persisting an ownerless profile.
      const userId = getUserId();
      if (!userId) {
        router.push(homeWithSchool);
        return;
      }

      const profile = {
        id: userId,
        faculty: data.faculty,
        interests: data.selectedTopics,
        isFirstYear: data.isFirstYear,
        school: data.school,
        role: "user" as const,
        hasOrganization: false,
        clubs: [],
        organizationId: null,
        organizationName: null,
      };

      // Persist to localStorage before navigate so `useAuthState` sees
      // `profileCompleted` (mirrors authenticated session) on the next render.
      persistProfile(profile);
      if (data.dailyNewEventsOptIn) {
        setDailyNewEventsEmailPreferenceAPI(true).catch((err) =>
          console.error("Failed to persist daily new-events email preference:", err)
        );
      }

      router.push(homeWithSchool);
    },
    [router, persistProfile]
  );

  const flow = useOnboardingFlow({ onComplete: handleComplete, initialSchool });

  const isDoneStep = flow.currentStep === 5;

  const stepContent: Record<number, JSX.Element> = {
    0: <div className="w-full min-h-[120px]" aria-hidden />,
    1: (
      <OnboardingYearStep
        isFirstYear={flow.isFirstYear}
        onChange={flow.setIsFirstYear}
      />
    ),
    2: (
      <MultiSelect
        className="max-w-md mx-auto"
        options={getEventCategories()}
        selected={flow.selectedTopics}
        onToggle={flow.toggleTopic}
      />
    ),
    3: (
      <OnboardingEventGrid
        selectedEventIds={flow.selectedEventIds}
        onToggleEventId={flow.toggleEventId}
      />
    ),
    4: (
      <OnboardingFacultyStep
        faculty={flow.faculty}
        onFacultyChange={flow.setFaculty}
      />
    ),
    5: (
      <OnboardingEmailOptInStep
        checked={flow.dailyNewEventsOptIn}
        onCheckedChange={flow.setDailyNewEventsOptIn}
      />
    ),
  };

  const gooseMessage = useMemo(() => {
    if (flow.currentStep === 3) {
      return flow.school
        ? t("onboarding.gooseStep3WithSchool", { school: translateSchool(flow.school) })
        : t("onboarding.gooseStep3Default");
    }
    const key = GOOSE_MESSAGE_KEYS[flow.currentStep];
    return key ? t(key) : "";
  }, [flow.currentStep, flow.school, t]);

  return (
    <main className="h-dvh bg-background flex flex-col overflow-hidden">
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

      {/* Scroll container: the sticky dialogue reserves its own space, so
          tall step content (e.g. the event grid) scrolls above it instead
          of overlapping it. */}
      <div className="flex-1 flex flex-col overflow-y-auto pt-20">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <div className="w-full max-w-3xl">
            <AnimatePresence mode="wait">
              <m.div
                key={flow.currentStep}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full"
              >
                {stepContent[flow.currentStep]}
              </m.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="sticky bottom-0 px-6 pb-6 pt-4 bg-background">
          <GooseDialogue
            message={gooseMessage}
            onBack={flow.goBack}
            onNext={flow.goNext}
            nextDisabled={!flow.canContinue}
            showBack={flow.currentStep > 0}
            nextLabel={isDoneStep ? t("onboarding.doneNextLabel") : undefined}
          />
        </div>
      </div>
    </main>
  );
}
