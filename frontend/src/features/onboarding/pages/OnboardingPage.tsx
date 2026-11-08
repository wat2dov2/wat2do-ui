import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { useOnboardingFlow } from "../hooks/useOnboardingFlow";
import { useOnboardingSchool } from "../hooks/useOnboardingSchool";
import { useUpdateProfile } from "../hooks/useUpdateProfile";
import { getUserProfile } from "@/features/auth";
import { OnboardingEventGrid } from "../components/OnboardingEventGrid";
import { OnboardingFacultyStep } from "../components/OnboardingFacultyStep";
import { GooseDialogue } from "../components/GooseDialogue";
import { OnboardingFrame } from "../components/OnboardingFrame";
import { OnboardingYearStep } from "../components/OnboardingYearStep";
import { MultiSelect } from "@/shared/ui/multi-select";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { getSafeReturnTo } from "@/features/auth/utils/returnTo";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

// Steps overlap: the next one arrives while the last one leaves (popLayout),
// easing out on the way in and leaving 20% faster, easing in.
const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.24, ease: "easeIn" } },
} as const;

const GOOSE_MESSAGE_KEYS: Record<number, string> = {
  0: "onboarding.gooseStep0",
  1: "onboarding.gooseStep1",
  2: "onboarding.gooseStep2",
  4: "onboarding.gooseStep4",
};

export function OnboardingPage() {
  const { event_categories: eventCategories } = useAppConstants();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { persistProfile } = useUpdateProfile();
  const { getSchoolName } = useSchoolDirectory();

  const initialSchool = useOnboardingSchool();
  const returnTo = useMemo(
    () => getSafeReturnTo(searchParams.get(QP.RETURN_TO)),
    [searchParams],
  );

  const handleComplete = useCallback(
    (data: {
      school: string;
      interests: string[];
      faculty: string;
      isFirstYear: boolean;
    }) => {
      const homeWithSchool = `${ROUTES.EVENTS}?${new URLSearchParams({ [QP.SCHOOL]: data.school })}`;

      // Anonymous preview (reached via the "continue without signing in" path):
      // there is no account to attach preferences to, so send them straight to
      // their school feed instead of persisting an ownerless profile.
      const currentProfile = getUserProfile();
      const userId = currentProfile?.id;
      if (!userId) {
        router.push(homeWithSchool);
        return;
      }

      const profile = {
        ...currentProfile,
        id: userId,
        fullName: currentProfile?.fullName ?? null,
        avatarUrl: currentProfile?.avatarUrl ?? null,
        faculty: data.faculty,
        interests: data.interests,
        isFirstYear: data.isFirstYear,
        school: data.school,
        role: "user" as const,
        hasClub: false,
        clubs: [],
        clubId: null,
        clubName: null,
        payoutEmail: currentProfile?.payoutEmail ?? null,
        promoterTosAcceptedAt: currentProfile?.promoterTosAcceptedAt ?? null,
        promoterTosVersion: currentProfile?.promoterTosVersion ?? null,
      };

      // Persist to localStorage before navigate so `useAuthState` sees
      // `profileCompleted` (mirrors authenticated session) on the next render.
      persistProfile(profile);
      router.push(returnTo ?? homeWithSchool);
    },
    [router, persistProfile, returnTo]
  );

  const flow = useOnboardingFlow({ onComplete: handleComplete, initialSchool });

  const isDoneStep = flow.currentStep === flow.totalSteps - 1;

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
        options={eventCategories}
        selected={flow.selectedTopics}
        onToggle={flow.toggleTopic}
        translationKeyPrefix="categories"
      />
    ),
    3: (
      <OnboardingEventGrid
        selectedEventIds={flow.selectedEventIds}
        onToggleEvent={flow.toggleEvent}
      />
    ),
    4: (
      <OnboardingFacultyStep
        school={flow.school}
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
      <OnboardingFrame
        currentStep={flow.currentStep}
        totalSteps={flow.totalSteps}
        dialogue={
          <GooseDialogue
            message={gooseMessage}
            onBack={flow.goBack}
            onNext={flow.goNext}
            showBack={flow.currentStep > 0}
            nextLabel={isDoneStep ? t("onboarding.doneNextLabel") : undefined}
          />
        }
      >
        <AnimatePresence mode="popLayout">
          <m.div
            key={flow.currentStep}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full"
          >
            {stepContent[flow.currentStep]}
          </m.div>
        </AnimatePresence>
      </OnboardingFrame>
    </LazyMotion>
  );
}
