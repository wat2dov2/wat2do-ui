import { useState, useRef, useCallback, startTransition, useEffect } from "react";

const TOTAL_STEPS = 5;

interface UseOnboardingStepsOptions {
  isOpen: boolean;
  onStepChange?: (step: number) => void;
}

/**
 * Hook for managing onboarding step navigation
 */
export function useOnboardingSteps({ isOpen, onStepChange }: UseOnboardingStepsOptions) {
  const [currentStep, setCurrentStep] = useState(0);
  const prevIsOpenRef = useRef(isOpen);
  const prevStepRef = useRef(currentStep);

  // Reset step when modal opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      startTransition(() => {
        setCurrentStep(0);
      });
    } else if (!isOpen) {
      prevIsOpenRef.current = isOpen;
    }
  }, [isOpen]);

  // Call onStepChange callback when step changes
  useEffect(() => {
    if (prevStepRef.current !== currentStep) {
      prevStepRef.current = currentStep;
      onStepChange?.(currentStep);
    }
  }, [currentStep, onStepChange]);

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep]);

  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < TOTAL_STEPS) {
      setCurrentStep(step);
    }
  }, []);

  return {
    currentStep,
    totalSteps: TOTAL_STEPS,
    handleNext,
    handlePrevious,
    goToStep,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === TOTAL_STEPS - 1,
  };
}
