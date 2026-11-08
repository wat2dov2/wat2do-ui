import { useCallback, useMemo, useState } from "react";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";
import { onboardingInterests } from "../utils/onboardingInterests";

const ONBOARDING_STEPS_WITHOUT_FACULTY = 4;

/**
 * How many steps onboarding has: year, topics and events, then the school's
 * faculties when it lists any (with none on file there is nothing to pick).
 */
export function useOnboardingStepCount(school: string): number {
  const { schoolBySlug } = useSchoolDirectory();
  const faculties = schoolBySlug.get(school)?.faculties ?? [];
  return ONBOARDING_STEPS_WITHOUT_FACULTY + (faculties.length > 0 ? 1 : 0);
}

interface UseOnboardingFlowOptions {
  onComplete: (data: {
    school: string;
    /** The picked topics plus the categories of the events tapped in step 3. */
    interests: string[];
    faculty: string;
    isFirstYear: boolean;
  }) => void;
  /**
   * School name to pre-populate on mount (e.g. from signup email domain via
   * the `?school=` query param). Defaults to an empty string.
   */
  initialSchool?: string;
}

export function useOnboardingFlow({ onComplete, initialSchool }: UseOnboardingFlowOptions) {
  const { event_categories: eventCategories } = useAppConstants();
  const [step, setStep] = useState(0);
  const school = initialSchool ?? "";
  const totalSteps = useOnboardingStepCount(school);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [pickedEvents, setPickedEvents] = useState<Event[]>([]);
  const [faculty, setFaculty] = useState("");
  const [isFirstYear, setIsFirstYear] = useState<boolean | null>(null);

  const validTopics = useMemo(
    () => selectedTopics.filter((topic) => eventCategories.includes(topic)),
    [selectedTopics, eventCategories]
  );

  const selectedEventIds = useMemo(() => pickedEvents.map((event) => event.id), [pickedEvents]);

  const toggleEvent = useCallback((event: Event) => {
    setPickedEvents((prev) =>
      prev.some((picked) => picked.id === event.id)
        ? prev.filter((picked) => picked.id !== event.id)
        : [...prev, event]
    );
  }, []);

  const toggleTopic = useCallback((topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((value) => value !== topic) : [...prev, topic]
    );
  }, []);

  const goNext = useCallback(() => {
    if (step >= totalSteps - 1) {
      onComplete({
        school,
        interests: onboardingInterests(validTopics, pickedEvents),
        faculty,
        isFirstYear: isFirstYear ?? false,
      });
      return;
    }

    setStep((prev) => prev + 1);
  }, [
    validTopics,
    school,
    faculty,
    isFirstYear,
    step,
    pickedEvents,
    onComplete,
    totalSteps,
  ]);

  const goBack = useCallback(() => {
    setStep((prev) => (prev <= 0 ? 0 : prev - 1));
  }, []);

  return {
    currentStep: step,
    totalSteps,
    school,
    selectedTopics,
    selectedEventIds,
    faculty,
    isFirstYear,
    setFaculty,
    setIsFirstYear,
    toggleTopic,
    toggleEvent,
    goNext,
    goBack,
  };
}
