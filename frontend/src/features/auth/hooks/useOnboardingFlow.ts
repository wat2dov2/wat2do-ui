import { useCallback, useMemo } from "react";
import { useAuthFlowStore } from "@/features/auth/store/authFlow.store";
import { EVENT_CATEGORIES, type EventCategory } from "@/shared/constants/eventCategories";

export const ONBOARDING_TOTAL_STEPS = 6;
export { EVENT_CATEGORIES, type EventCategory };

export const ONBOARDING_EVENT_CARDS: Record<string, { title: string; org: string; image: string }> = {
  "Clubs": { title: "Club Fair 2026", org: "Student Union", image: "https://images.unsplash.com/photo-1529543544282-ea69407b3656?w=400&h=200&fit=crop" },
  "Academic": { title: "Research Symposium", org: "Graduate Studies", image: "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=400&h=200&fit=crop" },
  "Religious": { title: "Interfaith Gathering", org: "Chaplain's Office", image: "https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=400&h=200&fit=crop" },
  "Cultural": { title: "Diwali Celebration", org: "South Asian Association", image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=200&fit=crop" },
  "Social & Games": { title: "Welcome Week BBQ", org: "Residence Life", image: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=200&fit=crop" },
  "Sports": { title: "Intramural Volleyball", org: "Campus Rec", image: "https://images.unsplash.com/photo-1461896836934-bd45ba1e9271?w=400&h=200&fit=crop" },
  "Career": { title: "Tech Career Fair", org: "Career Centre", image: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=400&h=200&fit=crop" },
};

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
  const store = useAuthFlowStore();
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
