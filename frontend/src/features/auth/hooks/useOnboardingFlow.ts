import { useCallback, useMemo } from "react";
import { useAuthFlowState } from "@/features/auth/store/authFlow.store";
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
}

export function useOnboardingFlow({ onComplete }: UseOnboardingFlowOptions) {
  const store = useAuthFlowState();
  const { onboarding } = store.state;

  const validTopics = useMemo(
    () => onboarding.selectedTopics.filter((t) => EVENT_CATEGORIES.includes(t as EventCategory)),
    [onboarding.selectedTopics]
  );

  // All questions optional — user can always continue
  const canContinue = true;

  const toggleTopic = useCallback(
    (category: string) => {
      const isSelected = onboarding.selectedTopics.includes(category);
      if (isSelected) {
        store.setSelectedTopics(onboarding.selectedTopics.filter((t) => t !== category));
      } else {
        store.setSelectedTopics([...onboarding.selectedTopics, category]);
      }
    },
    [onboarding.selectedTopics, store]
  );

  const toggleEventId = useCallback(
    (eventId: number) => {
      const isSelected = onboarding.selectedEventIds.includes(eventId);
      if (isSelected) {
        store.setSelectedEventIds(onboarding.selectedEventIds.filter((id) => id !== eventId));
      } else {
        store.setSelectedEventIds([...onboarding.selectedEventIds, eventId]);
      }
    },
    [onboarding.selectedEventIds, store]
  );

  const goNext = useCallback(() => {
    if (!canContinue) return;

    if (onboarding.step >= ONBOARDING_TOTAL_STEPS - 1) {
      onComplete({
        school: onboarding.school,
        selectedTopics: validTopics,
        selectedEventIds: onboarding.selectedEventIds,
        faculty: onboarding.faculty,
        isFirstYear: onboarding.isFirstYear ?? false,
      });
      return;
    }

    store.setOnboardingStep(onboarding.step + 1);
  }, [
    canContinue,
    validTopics,
    onboarding.school,
    onboarding.faculty,
    onboarding.isFirstYear,
    onboarding.step,
    onboarding.selectedEventIds,
    onComplete,
    store,
  ]);

  const goBack = useCallback(() => {
    if (onboarding.step <= 0) return;
    store.setOnboardingStep(onboarding.step - 1);
  }, [onboarding.step, store]);

  const resetOnboarding = useCallback(() => {
    store.resetOnboarding();
  }, [store]);

  return {
    currentStep: onboarding.step,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    school: onboarding.school,
    selectedTopics: onboarding.selectedTopics,
    selectedEventIds: onboarding.selectedEventIds,
    faculty: onboarding.faculty,
    isFirstYear: onboarding.isFirstYear,
    canContinue,
    setFaculty: store.setFaculty,
    setIsFirstYear: store.setIsFirstYear,
    toggleTopic,
    toggleEventId,
    goNext,
    goBack,
    resetOnboarding,
  };
}
