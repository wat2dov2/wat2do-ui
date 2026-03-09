import { useState, useCallback } from "react";

interface UseOnboardingOTPOptions {
  onComplete: () => void;
}

/**
 * Hook for managing OTP verification in onboarding
 */
export function useOnboardingOTP({ onComplete }: UseOnboardingOTPOptions) {
  const [otpValue, setOtpValue] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);

  const handleOtpComplete = useCallback((value: string) => {
    if (value.length === 6) {
      setIsVerifying(true);
      setTimeout(() => {
        setIsVerifying(false);
        setShowOtpInput(false);
        onComplete();
      }, 800);
    }
  }, [onComplete]);

  const resetOtp = useCallback(() => {
    setOtpValue("");
    setIsVerifying(false);
    setShowOtpInput(false);
  }, []);

  return {
    otpValue,
    setOtpValue,
    isVerifying,
    showOtpInput,
    setShowOtpInput,
    handleOtpComplete,
    resetOtp,
  };
}
