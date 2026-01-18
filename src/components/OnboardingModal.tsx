import React, { useState, useEffect, useCallback } from "react";
import { Check, Sparkles, Heart, ChevronLeft } from "lucide-react";
import confetti from "canvas-confetti";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: OnboardingData) => void;
}

interface OnboardingData {
  faculty: string;
  isFirstYear: boolean;
  interests: string[];
  email?: string;
}

const TOTAL_STEPS = 5;

const availableFaculties = [
  "Engineering",
  "Mathematics",
  "Science",
  "Arts",
  "Environment",
  "Health",
  "Applied Health Sciences",
];

const availableInterests = [
  "Academic",
  "Social",
  "Career",
  "Sports",
  "Music",
  "Art",
  "Technology",
  "Gaming",
  "Food",
  "Networking",
];

const GOOSE_IMAGE_URL =
  "https://lh3.googleusercontent.com/rd-gg-dl/ABS2GSnULbbntBOQGWx17qUnha4hcyKXW4asH7zxR0zV3dANdBEYPEagYhHMszDOKX9O5kdpGZzZIFkeec9LyOLiy1zV2IvIbdipr-2UrDPSBEmaOUGefddFgFNJWzaLGire29cPMIU0ypmBaj88c5EJ8EJyZt6fv3xo0Y-LV-R7d96pf6Ig6GCvFgAkIpFOZqGQ0z6wpSfun0c8OZi-4oQJziK2vs3gVWP7UN_aeImAe_lWlxpy47iTUzRShknBpGNPtDEMk9x3RZdzYuU21tbT4lQZHL2pdA6oAwppje-Id8aceQu0b4Legme-nb60_-0oQJHJ0bWVgfu3lMwQ_tZjGQBFF8UNt92y17hbrE92eIyFLnxxHGVR43X9aeIukNwVlx-zIZXzWSkv2Xe0CGkViJ2MmCOHEWwAQoaIDi86f7uMn97bg-i7_7cO4cR5snB574v-s94b3KSg-XoqNUxiAkZgRqITK9Rx8YaRxZMuqfRb0nBjaA1iWhP8ln24wKfrugS5X8dJFpExxq-wQhh7zvjFcbVjdI-G9dUaBtji5UjCJUu5Y_HYMu9BfNTvAMAC6KRimkLHoue_biInFKWdwpr77m6t48XH3Psohdg11Jx-d5zaTjASWfUgm_pSqDADN0EJnRqkVZiDCJgmk1zWpkdmWbpq_iFfTQE7kLv5xKEQw9QIGlfBISP98XHpcK_A4JyTd20pKASFWjfGD1zK6S3HfznvUW3qqpbjdE15rDZa0qsGqaImOVLjIAXEehfcl-o-w6EWMXcpPS283P3S3mkh7J7X2J0bL3hE3z6kPt81SHPuZzifLqQmR237Q9DjtsUoLZpHY-u_um2-JpdGbygK6m5geh_c4Gxm-4FQ75ksSSh12c0gGI9n6Wtbt0dclDyno-RgNzEinsI1bt_5UYQyvsxtGo98BEWwYzfc70_2JGyElBxCVuM_SU2Jva19sKtekc1SoDAQgOixWsmchfnna83xk64CQ-TGm_AgB97ZjxqbpDlRYAL-CNa7bzGecRhhoZVOb840TJ-62vulNL2CPFG0fG5e2uaNGMo6q6WAa20K6fmY4_fPYBOTm3DGryIPPWMAatdv3Pp6BhjZJuWsLkxInyyy_ixin38D53OXfzg9ZCEqIJRudGCgF-VrtwW1V4SeP3PMch0dAzCqL4NUe2p29STX1Xeh-Ypvzs0kjqSNQaRPq9g=s1024-rj";

export function OnboardingModal({
  isOpen,
  onClose,
  onComplete,
}: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFaculty, setSelectedFaculty] = useState("");
  const [isFirstYear, setIsFirstYear] = useState<boolean | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [emailUsername, setEmailUsername] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setSelectedFaculty("");
      setIsFirstYear(null);
      setSelectedInterests([]);
      setEmailUsername("");
      setOtpValue("");
      setIsVerifying(false);
      setShowOtpInput(false);
    }
  }, [isOpen]);

  // Fire confetti when reaching the final step
  const fireConfetti = useCallback(() => {
    const duration = 500;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: ['#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors: ['#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  useEffect(() => {
    if (currentStep === 4 && isOpen) {
      fireConfetti();
    }
  }, [currentStep, isOpen, fireConfetti]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete({
        faculty: selectedFaculty,
        isFirstYear: isFirstYear ?? false,
        interests: selectedInterests,
        email: emailUsername ? `${emailUsername}@gmail.com` : undefined,
      });
      onClose();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    // Skip is only allowed for interests step (step 3)
    if (currentStep === 3) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleOtpComplete = (value: string) => {
    if (value.length === 6) {
      setIsVerifying(true);
      setTimeout(() => {
        setIsVerifying(false);
        setShowOtpInput(false);
        setCurrentStep(2); // Move to school selection
      }, 800);
    }
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  // Progress for steps 1-3 (Sign in, School, Interests) - excludes Welcome and All Set
  const visibleSteps = 3;
  const displayStep = currentStep >= 1 && currentStep <= 3 ? currentStep : 0;
  const progressValue = currentStep === 0 ? 0 : currentStep >= 4 ? 100 : (displayStep / visibleSteps) * 100;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-2xl">
        {/* Progress bar - only show for steps 1-3 */}
        {currentStep >= 1 && currentStep <= 3 && (
          <div style={{ marginRight: 24 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Step {displayStep} of {visibleSteps}
              </span>
              <span className="text-xs text-muted-foreground">
                {Math.round(progressValue)}%
              </span>
            </div>
            <Progress value={progressValue} className="h-1" />
          </div>
        )}

        {/* Content */}
        <div>
          {/* Step 1: Welcome */}
          {currentStep === 0 && (
            <div className="flex flex-col items-center text-center">
              {/* Goose Image */}
              <div className="w-24 h-24 rounded-full overflow-hidden mb-4 bg-muted">
                <img
                  src={GOOSE_IMAGE_URL}
                  alt="Goose mascot"
                  className="w-full h-full object-cover"
                />
              </div>

              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">Welcome to wat2do</DialogTitle>
                <DialogDescription className="text-center">
                  Discover campus events, connect with clubs, and never miss out
                  on what's happening.
                </DialogDescription>
              </DialogHeader>

              <Button onClick={handleNext} className="w-full">
                Get Started
              </Button>
            </div>
          )}

          {/* Step 2: Sign In (includes OTP on same step) */}
          {currentStep === 1 && (
            <div className="flex flex-col">
              {!showOtpInput ? (
                <>
                  <DialogHeader className="space-y-2 mb-6 text-center">
                    <DialogTitle className="text-xl text-center">
                      Sign in
                    </DialogTitle>
                    <DialogDescription className="text-center">
                      Choose how you'd like to continue
                    </DialogDescription>
                  </DialogHeader>

                  {/* Google Sign In Button */}
                  <button
                    onClick={() => {
                      setEmailUsername("demo.user");
                      handleNext();
                    }}
                    className="w-full h-11 flex items-center justify-center gap-3 rounded-md border border-border transition-colors hover:bg-gray-200 mb-4"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span className="font-medium text-sm text-foreground">
                      Continue with Google
                    </span>
                  </button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Email Input */}
                  <div className="space-y-2 mb-4">
                    <label className="text-sm font-medium text-foreground">
                      Email
                    </label>
                    <div className="flex items-center">
                      <input
                        type="text"
                        value={emailUsername}
                        onChange={(e) => setEmailUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                        placeholder="username"
                        className="flex-1 h-10 px-3 text-sm rounded-l-md border border-r-0 border-border focus:outline-none focus:ring-2 focus:ring-primary bg-muted text-foreground placeholder:text-muted-foreground"
                      />
                      <div
                        className="h-10 px-3 flex items-center text-sm font-medium rounded-r-md border border-border bg-muted text-muted-foreground"
                      >
                        @gmail.com
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={handleBack}
                      className="flex-1 text-muted-foreground"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                      Back
                    </Button>
                    <Button
                      onClick={() => setShowOtpInput(true)}
                      disabled={!emailUsername}
                      className="flex-1"
                    >
                      Continue
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <DialogHeader className="space-y-2 mb-6 text-center">
                    <DialogTitle className="text-xl text-center">
                      Verify your email
                    </DialogTitle>
                    <DialogDescription className="text-center">
                      We sent a 6-digit code to {emailUsername}@gmail.com
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex justify-center mb-6">
                    <InputOTP
                      maxLength={6}
                      value={otpValue}
                      onChange={(value) => {
                        setOtpValue(value);
                        if (value.length === 6) {
                          handleOtpComplete(value);
                        }
                      }}
                      disabled={isVerifying}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {isVerifying ? (
                    <p className="text-center text-sm font-medium text-foreground">
                      Verifying...
                    </p>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      Enter any 6 digits to continue
                    </p>
                  )}

                  <div className="mt-6">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setOtpValue("");
                        setShowOtpInput(false);
                      }}
                      className="w-full"
                      disabled={isVerifying}
                    >
                      Change email
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 3: Faculty & First Year Selection */}
          {currentStep === 2 && (
            <div className="flex flex-col">
              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">
                  Tell us about yourself
                </DialogTitle>
                <DialogDescription className="text-center">
                  We'll personalize events based on your profile
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mb-6">
                {/* Faculty Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Faculty
                  </label>
                  <Select value={selectedFaculty} onValueChange={setSelectedFaculty}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose your faculty" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFaculties.map((faculty) => (
                        <SelectItem key={faculty} value={faculty}>
                          {faculty}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* First Year Question */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">
                    Are you a first year student?
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsFirstYear(true)}
                      className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all border ${
                        isFirstYear === true
                          ? "bg-primary text-white border-primary shadow-md"
                          : "bg-muted text-muted-foreground border-border hover:bg-gray-200"
                      }`}
                    >
                      Yes, I'm a first year! 🎉
                    </button>
                    <button
                      onClick={() => setIsFirstYear(false)}
                      className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all border ${
                        isFirstYear === false
                          ? "bg-primary text-white border-primary shadow-md"
                          : "bg-muted text-muted-foreground border-border hover:bg-gray-200"
                      }`}
                    >
                      No, returning student
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  className="flex-1 text-muted-foreground"
                >
                  <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={!selectedFaculty || isFirstYear === null}
                  className="flex-1"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Interests */}
          {currentStep === 3 && (
            <div className="flex flex-col">
              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">
                  What are you into?
                </DialogTitle>
                <DialogDescription className="text-center">
                  Select topics to personalize your feed
                </DialogDescription>
              </DialogHeader>

              <div className="mb-6">
                {/* Interest Toggle Buttons - Flex wrapped */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {availableInterests.map((interest) => {
                    const isSelected = selectedInterests.includes(interest);
                    return (
                      <button
                        key={interest}
                        onClick={() => toggleInterest(interest)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${isSelected
                          ? "bg-primary text-white shadow-md"
                          : "bg-muted text-muted-foreground hover:bg-gray-200"
                          }`}
                      >
                        {interest}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground text-center mt-4">
                  {selectedInterests.length} of {availableInterests.length} selected
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    className="flex-1 text-muted-foreground"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                    Back
                  </Button>
                  <Button onClick={handleNext} className="flex-1">
                    Continue
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="w-full"
                >
                  Skip for now
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: All Set */}
          {currentStep === 4 && (
            <div className="flex flex-col items-center text-center">
              {/* Success Icon */}
              <div className="relative mb-4">
                <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                  <Check className="w-8 h-8 text-white" strokeWidth={3} />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              </div>

              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">You're all set!</DialogTitle>
                <DialogDescription className="text-center">
                  Your personalized feed is ready. Let's discover some amazing
                  events!
                </DialogDescription>
              </DialogHeader>

              {/* Summary */}
              {(emailUsername || selectedFaculty || selectedInterests.length > 0) && (
                <div className="w-full rounded-xl p-4 mb-6 text-left text-sm bg-muted">
                  {emailUsername && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">Email:</span>{" "}
                      {emailUsername}@gmail.com
                    </p>
                  )}
                  {selectedFaculty && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">Faculty:</span>{" "}
                      {selectedFaculty}
                    </p>
                  )}
                  {isFirstYear !== null && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">Year:</span>{" "}
                      {isFirstYear ? "First Year" : "Returning Student"}
                    </p>
                  )}
                  {selectedInterests.length > 0 && (
                    <p className="text-foreground">
                      <span className="text-muted-foreground">Interests:</span>{" "}
                      {selectedInterests.join(", ")}
                    </p>
                  )}
                </div>
              )}

              <Button onClick={handleNext} className="w-full">
                Start Exploring
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingModal;
