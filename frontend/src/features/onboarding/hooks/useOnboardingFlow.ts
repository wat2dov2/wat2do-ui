import { useCallback, useMemo, useState } from "react";
import { isEventCategory } from "@/shared/data/eventCategories";

const ONBOARDING_TOTAL_STEPS = 6;

export const FACULTY_OPTIONS = [
  "Engineering",
  "Mathematics",
  "Science",
  "Arts",
  "Environment",
  "Health",
  "Applied Health Sciences",
] as const;

interface UseOnboardingFlowOptions {
  onComplete: (data: {
    school: string;
    selectedTopics: string[];
    selectedEventIds: number[];
    faculty: string;
    isFirstYear: boolean;
    dailyNewEventsOptIn: boolean;
  }) => void;
  /**
   * School name to pre-populate on mount (e.g. from signup email domain via
   * the `?school=` query param). Defaults to an empty string.
   */
  initialSchool?: string;
}

export function useOnboardingFlow({ onComplete, initialSchool }: UseOnboardingFlowOptions) {
  const [step, setStep] = useState(0);
  const school = initialSchool ?? "";
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<number[]>([]);
  const [faculty, setFaculty] = useState("");
  const [isFirstYear, setIsFirstYear] = useState<boolean | null>(null);
  const [dailyNewEventsOptIn, setDailyNewEventsOptIn] = useState(false);

  const validTopics = useMemo(
    () => selectedTopics.filter((t) => isEventCategory(t)),
    [selectedTopics]
  );

  // All questions optional - user can always continue
  const canContinue = true;

  const toggleEventId = useCallback((eventId: number) => {
    setSelectedEventIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
    );
  }, []);

  const toggleTopic = useCallback((topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((value) => value !== topic) : [...prev, topic]
    );
  }, []);

  const goNext = useCallback(() => {
    if (!canContinue) return;

    if (step >= ONBOARDING_TOTAL_STEPS - 1) {
      onComplete({
        school,
        selectedTopics: validTopics,
        selectedEventIds,
        faculty,
        isFirstYear: isFirstYear ?? false,
        dailyNewEventsOptIn,
      });
      return;
    }

    setStep((prev) => prev + 1);
  }, [
    canContinue,
    validTopics,
    school,
    faculty,
    isFirstYear,
    step,
    selectedEventIds,
    dailyNewEventsOptIn,
    onComplete,
  ]);

  const goBack = useCallback(() => {
    setStep((prev) => (prev <= 0 ? 0 : prev - 1));
  }, []);

  return {
    currentStep: step,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    school,
    selectedTopics,
    selectedEventIds,
    faculty,
    isFirstYear,
    dailyNewEventsOptIn,
    canContinue,
    setFaculty,
    setIsFirstYear,
    setDailyNewEventsOptIn,
    setSelectedTopics,
    toggleTopic,
    toggleEventId,
    goNext,
    goBack,
  };
}
