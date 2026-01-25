import { useState, useCallback, useEffect, useRef, startTransition } from "react";

interface UseOnboardingFormOptions {
  isOpen: boolean;
}

interface OnboardingData {
  faculty: string;
  isFirstYear: boolean;
  interests: string[];
  email?: string;
}

/**
 * Hook for managing onboarding form state
 */
export function useOnboardingForm({ isOpen }: UseOnboardingFormOptions) {
  const [selectedFaculty, setSelectedFaculty] = useState("");
  const [isFirstYear, setIsFirstYear] = useState<boolean | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [emailUsername, setEmailUsername] = useState("");
  const prevIsOpenRef = useRef(isOpen);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      startTransition(() => {
        setSelectedFaculty("");
        setIsFirstYear(null);
        setSelectedInterests([]);
        setEmailUsername("");
      });
    } else if (!isOpen) {
      prevIsOpenRef.current = isOpen;
    }
  }, [isOpen]);

  const toggleInterest = useCallback((interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  }, []);

  const getOnboardingData = useCallback((): OnboardingData => {
    return {
      faculty: selectedFaculty,
      isFirstYear: isFirstYear ?? false,
      interests: selectedInterests,
      email: emailUsername ? `${emailUsername}@gmail.com` : undefined,
    };
  }, [selectedFaculty, isFirstYear, selectedInterests, emailUsername]);

  return {
    selectedFaculty,
    setSelectedFaculty,
    isFirstYear,
    setIsFirstYear,
    selectedInterests,
    toggleInterest,
    emailUsername,
    setEmailUsername,
    getOnboardingData,
  };
}
