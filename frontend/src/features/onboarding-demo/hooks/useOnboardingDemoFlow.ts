import { useCallback, useMemo, useState } from "react";
import {
  DEMO_EVENTS,
  INTEREST_CATEGORY_MAP,
  ONBOARDING_DEMO_STEPS,
} from "../constants";
import type {
  EventReaction,
  OnboardingDemoState,
  OnboardingDemoStep,
  SocialMode,
} from "../types";

const INITIAL_STATE: OnboardingDemoState = {
  interests: [],
  availability: [],
  reactions: {},
  proTrialAccepted: false,
};

function getReactionCount(reactions: Record<number, EventReaction>): number {
  return Object.keys(reactions).length;
}

export function useOnboardingDemoFlow() {
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<OnboardingDemoState>(INITIAL_STATE);

  const currentStep = ONBOARDING_DEMO_STEPS[stepIndex];

  const interestedEventIds = useMemo(
    () =>
      Object.entries(state.reactions)
        .filter(([, r]) => r === "interested")
        .map(([id]) => Number(id)),
    [state.reactions]
  );

  const matchedEvents = useMemo(() => {
    const categories = new Set(
      state.interests.flatMap((i) => INTEREST_CATEGORY_MAP[i] ?? [])
    );
    if (categories.size === 0) return DEMO_EVENTS;
    const filtered = DEMO_EVENTS.filter((e) => categories.has(e.category));
    return filtered.length > 0 ? filtered : DEMO_EVENTS;
  }, [state.interests]);

  const previewEvents = useMemo(() => matchedEvents.slice(0, 4), [matchedEvents]);

  const interestedEvents = useMemo(
    () => DEMO_EVENTS.filter((e) => interestedEventIds.includes(e.id)),
    [interestedEventIds]
  );

  const strongestVibe = useMemo(() => {
    if (state.interests.length === 0) return "campus events";
    if (state.interests.length <= 2) return state.interests.join(" + ").toLowerCase();
    return `${state.interests.slice(0, 2).join(" + ").toLowerCase()} + more`;
  }, [state.interests]);

  const canContinue = useMemo(() => {
    switch (currentStep) {
      case "welcome":
        return Boolean(state.source);
      case "campus_intent":
        return state.interests.length > 0;
      case "availability":
        return state.availability.length > 0;
      case "event_match":
        return getReactionCount(state.reactions) >= 2;
      default:
        return true;
    }
  }, [currentStep, state]);

  const setSource = useCallback((source: string) => {
    setState((prev) => ({ ...prev, source }));
  }, []);

  const toggleInterest = useCallback((interest: string) => {
    setState((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  }, []);

  const toggleAvailability = useCallback((slot: string) => {
    setState((prev) => ({
      ...prev,
      availability: prev.availability.includes(slot)
        ? prev.availability.filter((s) => s !== slot)
        : [...prev.availability, slot],
    }));
  }, []);

  const setSocialMode = useCallback((socialMode: SocialMode) => {
    setState((prev) => ({ ...prev, socialMode }));
  }, []);

  const setReaction = useCallback((eventId: number, reaction: EventReaction) => {
    setState((prev) => ({
      ...prev,
      reactions: { ...prev.reactions, [eventId]: reaction },
    }));
  }, []);

  const acceptProTrial = useCallback(() => {
    setState((prev) => ({ ...prev, proTrialAccepted: true }));
  }, []);

  const goNext = useCallback(() => {
    if (!canContinue) return;
    setStepIndex((prev) => Math.min(prev + 1, ONBOARDING_DEMO_STEPS.length - 1));
  }, [canContinue]);

  const goBack = useCallback(() => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToStep = useCallback((step: OnboardingDemoStep) => {
    const index = ONBOARDING_DEMO_STEPS.indexOf(step);
    if (index >= 0) setStepIndex(index);
  }, []);

  const restart = useCallback(() => {
    setState(INITIAL_STATE);
    setStepIndex(0);
  }, []);

  return {
    currentStep,
    stepIndex,
    state,
    canContinue,
    matchedEvents,
    previewEvents,
    interestedEvents,
    strongestVibe,
    challengeProgress: interestedEventIds.length,
    setSource,
    toggleInterest,
    toggleAvailability,
    setSocialMode,
    setReaction,
    acceptProTrial,
    goNext,
    goBack,
    goToStep,
    restart,
    continueWithoutPicks: goNext,
  };
}

export type OnboardingDemoFlow = ReturnType<typeof useOnboardingDemoFlow>;
