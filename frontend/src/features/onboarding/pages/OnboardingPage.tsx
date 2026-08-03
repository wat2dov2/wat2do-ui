import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { useOnboardingFlow } from "../hooks/useOnboardingFlow";
import { useUpdateProfile } from "../hooks/useUpdateProfile";
import { getUserId, getUserProfile } from "@/features/auth";
import { OnboardingEventGrid } from "../components/OnboardingEventGrid";
import { OnboardingFacultyStep } from "../components/OnboardingFacultyStep";
import { GooseDialogue } from "../components/GooseDialogue";
import { OnboardingProgressDots } from "../components/OnboardingProgressDots";
import { OnboardingYearStep } from "../components/OnboardingYearStep";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { MultiSelect } from "@/shared/ui/multi-select";
import { getEventCategories } from "@/shared/data/eventCategories";
import { getSafeReturnTo } from "@/features/auth/utils/returnTo";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

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
};

export function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { persistProfile } = useUpdateProfile();
  const { getSchoolName } = useSchoolDirectory();

  // Signup flow hands the school over via the URL so a refresh preserves the
  // institution-specific onboarding greeting.
  const initialSchool = useMemo(() => {
    return searchParams.get(QP.SCHOOL) ?? "";
  }, [searchParams]);
  const returnTo = useMemo(
    () => getSafeReturnTo(searchParams.get(QP.RETURN_TO)),
    [searchParams],
  );

  const handleComplete = useCallback(
    (data: {
      school: string;
      selectedTopics: string[];
      selectedEventIds: number[];
      faculty: string;
      isFirstYear: boolean;
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
        ...getUserProfile(),
        id: userId,
        fullName: getUserProfile()?.fullName ?? null,
        avatarUrl: getUserProfile()?.avatarUrl ?? null,
        faculty: data.faculty,
        interests: data.selectedTopics,
        isFirstYear: data.isFirstYear,
        school: data.school,
        role: "user" as const,
        hasOrganization: false,
        clubs: [],
        organizationId: null,
        organizationName: null,
        payoutEmail: getUserProfile()?.payoutEmail ?? null,
        promoterTosAcceptedAt: getUserProfile()?.promoterTosAcceptedAt ?? null,
        promoterTosVersion: getUserProfile()?.promoterTosVersion ?? null,
      };

      // Persist to localStorage before navigate so `useAuthState` sees
      // `profileCompleted` (mirrors authenticated session) on the next render.
      persistProfile(profile);
      router.push(returnTo ?? homeWithSchool);
    },
    [router, persistProfile, returnTo]
  );

  const flow = useOnboardingFlow({ onComplete: handleComplete, initialSchool });

  const isDoneStep = flow.currentStep === 4;

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
        translationKeyPrefix="categories"
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
  };

  const gooseMessage = useMemo(() => {
    if (flow.currentStep === 3) {
      return flow.school
        ? t("onboarding.gooseStep3WithSchool", { school: getSchoolName(flow.school) })
        : t("onboarding.gooseStep3Default");
    }
    const key = GOOSE_MESSAGE_KEYS[flow.currentStep];
    return key ? t(key) : "";
  }, [flow.currentStep, flow.school, getSchoolName, t]);

  return (
    <LazyMotion features={domAnimation} strict>
      <main className="h-dvh bg-background flex flex-col overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-30 w-full px-6 pt-4 pb-4 bg-background flex items-center justify-between">
        <OnboardingProgressDots
          currentStep={flow.currentStep}
          totalSteps={flow.totalSteps}
        />
        <div className="flex items-center gap-2">
          <LanguageSelector />
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

        <div className="sticky bottom-0 z-30 px-6 pb-6 pt-4 bg-background">
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
    </LazyMotion>
  );
}
