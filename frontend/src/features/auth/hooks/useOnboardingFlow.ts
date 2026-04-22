import { useCallback, useMemo, useState } from "react";
import { EVENT_CATEGORIES, type EventCategory } from "@/shared/constants/eventCategories";
import { ONBOARDING_EVENT_CARDS } from "@/features/auth/data/onboardingImages";

export const ONBOARDING_TOTAL_STEPS = 6;
export { EVENT_CATEGORIES, type EventCategory };
export { ONBOARDING_EVENT_CARDS };

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
  }) => void;
  /**
   * School name to pre-populate on mount (e.g. derived from the signup
   * email domain and handed over via router navigation state). Defaults
   * to an empty string.
   */
  initialSchool?: string;
}

export function useOnboardingFlow({ onComplete, initialSchool }: UseOnboardingFlowOptions) {
  const [step, setStep] = useState(0);
  const [school] = useState(initialSchool ?? "");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<number[]>([]);
  const [faculty, setFaculty] = useState("");
  const [isFirstYear, setIsFirstYear] = useState<boolean | null>(null);

  const validTopics = useMemo(
    () => selectedTopics.filter((t) => EVENT_CATEGORIES.includes(t as EventCategory)),
    [selectedTopics]
  );

  // All questions optional — user can always continue
  const canContinue = true;

  const toggleTopic = useCallback((category: string) => {
    setSelectedTopics((prev) =>
      prev.includes(category) ? prev.filter((t) => t !== category) : [...prev, category]
    );
  }, []);

  const toggleEventId = useCallback((eventId: number) => {
    setSelectedEventIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
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
    canContinue,
    setFaculty,
    setIsFirstYear,
    toggleTopic,
    toggleEventId,
    goNext,
    goBack,
  };
}
