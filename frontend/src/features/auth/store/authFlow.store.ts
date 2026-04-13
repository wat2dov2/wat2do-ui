import { useCallback, useState } from "react";

export interface AuthFlowState {
  authEntry: {
    email: string;
  };
  onboarding: {
    step: number;
    school: string;
    selectedTopics: string[];
    selectedEventIds: number[];
    faculty: string;
    isFirstYear: boolean | null;
  };
}

const INITIAL_AUTH_FLOW_STATE: AuthFlowState = {
  authEntry: {
    email: "",
  },
  onboarding: {
    step: 0,
    school: "",
    selectedTopics: [],
    selectedEventIds: [],
    faculty: "",
    isFirstYear: null,
  },
};

/** Local state hook — not a shared store. Each call creates an isolated instance. */
export function useAuthFlowState() {
  const [state, setState] = useState<AuthFlowState>(INITIAL_AUTH_FLOW_STATE);

  const setAuthEmail = useCallback((email: string) => {
    setState((prev) => ({
      ...prev,
      authEntry: { ...prev.authEntry, email },
    }));
  }, []);

  const setOnboardingStep = useCallback((step: number) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, step },
    }));
  }, []);

  const setSchool = useCallback((school: string) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, school },
    }));
  }, []);

  const setSelectedTopics = useCallback((selectedTopics: string[]) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, selectedTopics },
    }));
  }, []);

  const setSelectedEventIds = useCallback((selectedEventIds: number[]) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, selectedEventIds },
    }));
  }, []);

  const setFaculty = useCallback((faculty: string) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, faculty },
    }));
  }, []);

  const setIsFirstYear = useCallback((isFirstYear: boolean | null) => {
    setState((prev) => ({
      ...prev,
      onboarding: { ...prev.onboarding, isFirstYear },
    }));
  }, []);

  const resetAuthEntry = useCallback(() => {
    setState((prev) => ({
      ...prev,
      authEntry: INITIAL_AUTH_FLOW_STATE.authEntry,
    }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setState((prev) => ({
      ...prev,
      onboarding: INITIAL_AUTH_FLOW_STATE.onboarding,
    }));
  }, []);

  return {
    state,
    setAuthEmail,
    setOnboardingStep,
    setSchool,
    setSelectedTopics,
    setSelectedEventIds,
    setFaculty,
    setIsFirstYear,
    resetAuthEntry,
    resetOnboarding,
  };
}
