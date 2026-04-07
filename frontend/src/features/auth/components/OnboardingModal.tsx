import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, ChevronLeft } from "lucide-react";
import { useConfetti } from "@/shared/hooks/useConfetti";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";
import { Progress } from "@/shared/ui/progress";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/ui/input-otp";
import { useOnboardingSteps } from "@/features/auth/hooks/useOnboardingSteps";
import { useOnboardingOTP } from "@/features/auth/hooks/useOnboardingOTP";
import { useOnboardingForm, type OnboardingData } from "@/features/auth/hooks/useOnboardingForm";
import { useModalState } from "@/shared/hooks/useModalState";
import { MultiSelect } from "@/shared/ui/multi-select";
import { getAvailableInterests } from "@/shared/data/interests";
import { updateUserProfile } from "@/features/auth/api/auth.api";
import { availableSchools, DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { GOOSE_IMAGE_URL } from "@/shared/constants/images";
import { GoogleLogo } from "@/shared/ui/google-logo";
import { translateInterest } from "@/shared/utils/translateInterest";
import { toFacultyKey, sanitizeEmailUsername } from "@/shared/utils/string";
import { OTP_LENGTH } from "@/features/auth/constants";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: OnboardingData) => void;
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

export function OnboardingModal({
  isOpen,
  onClose,
  onComplete,
}: OnboardingModalProps) {
  const { t } = useTranslation();
  const { triggerBurst } = useConfetti();

  // Use hooks for business logic
  const steps = useOnboardingSteps({ 
    isOpen,
    onStepChange: (step) => {
      // Fire confetti when reaching the final step
      if (step === 4 && isOpen) {
        triggerBurst(1);
      }
    },
  });
  const form = useOnboardingForm({ isOpen });
  const otp = useOnboardingOTP({
    onComplete: () => {
      steps.goToStep(2);
    },
  });
  const [isNextLoading, setIsNextLoading] = useState(false);

  const handleNext = async () => {
    if (steps.currentStep < steps.totalSteps - 1) {
      if (steps.currentStep === 3) {
        setIsNextLoading(true);
        try {
          const onboardingData = form.getOnboardingData();
          updateUserProfile({
            faculty: onboardingData.faculty,
            interests: onboardingData.interests,
            isFirstYear: onboardingData.isFirstYear,
            school: DEFAULT_SCHOOL,
          });
          onComplete({
            faculty: onboardingData.faculty,
            isFirstYear: onboardingData.isFirstYear,
            interests: onboardingData.interests,
            email: onboardingData.email,
          });
          steps.handleNext();
        } finally {
          setIsNextLoading(false);
        }
      } else {
        steps.handleNext();
      }
    } else {
      setIsNextLoading(true);
      try {
        const onboardingData = form.getOnboardingData();
        onComplete({
          faculty: onboardingData.faculty,
          isFirstYear: onboardingData.isFirstYear,
          interests: onboardingData.interests,
          email: onboardingData.email,
        });
        onClose();
      } finally {
        setIsNextLoading(false);
      }
    }
  };

  // Progress for steps 1-3 (Sign in, School, Interests) - excludes Welcome and All Set
  const visibleSteps = 3;
  const displayStep = steps.currentStep >= 1 && steps.currentStep <= 3 ? steps.currentStep : 0;
  const progressValue = steps.currentStep === 0 ? 0 : steps.currentStep >= 4 ? 100 : (displayStep / visibleSteps) * 100;

  const modalState = useModalState({ onClose });

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-2xl">
        {/* Progress bar - only show for steps 1-3 */}
        {steps.currentStep >= 1 && steps.currentStep <= 3 && (
          <div style={{ marginRight: 24 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                {t("modals.onboarding.stepProgress", { step: displayStep, total: visibleSteps })}
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
          {steps.currentStep === 0 && (
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
                <DialogTitle className="text-xl text-center">{t("modals.welcome.title")}</DialogTitle>
                <DialogDescription className="text-center">
                  {t("modals.welcome.description")}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <LoadingButton onClick={handleNext} className="w-full" isLoading={isNextLoading} loadingText={t("common.pleaseWait") || "Please wait..."}>
                  {t("modals.getStarted")}
                </LoadingButton>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Sign In (includes OTP on same step) */}
          {steps.currentStep === 1 && (
            <div className="flex flex-col">
              {!otp.showOtpInput ? (
                <>
                  <DialogHeader className="space-y-2 mb-6 text-center">
                    <DialogTitle className="text-xl text-center">
                      {t("modals.signIn.title")}
                    </DialogTitle>
                    <DialogDescription className="text-center">
                      {t("modals.signIn.description")}
                    </DialogDescription>
                  </DialogHeader>

                  {/* Google Sign In Button */}
                  <button
                    onClick={() => {
                      form.setEmailUsername("demo.user");
                      handleNext();
                    }}
                    className="w-full h-11 flex items-center justify-center gap-3 rounded-md border border-border transition-colors hover:bg-secondary mb-4"
                  >
                    <GoogleLogo />
                    <span className="font-medium text-sm text-foreground">
                      {t("modals.signIn.continueWithGoogle")}
                    </span>
                  </button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">{t("common.or")}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Email Input */}
                  <Field className="mb-4">
                    <FieldLabel htmlFor="email-username" className="text-sm font-medium text-foreground">
                      {t("settings.profile.email")}
                    </FieldLabel>
                    <div className="flex items-center">
                      <Input
                        id="email-username"
                        type="text"
                        value={form.emailUsername}
                        onChange={(e) => form.setEmailUsername(sanitizeEmailUsername(e.target.value))}
                        placeholder={t("modals.signIn.username")}
                        className="flex-1 h-10 text-sm rounded-l-md rounded-r-none border-r-0"
                      />
                      <div
                        className="h-10 px-3 flex items-center text-sm font-medium rounded-r-md border border-l-0 border-border bg-muted text-muted-foreground"
                      >
                        @gmail.com
                      </div>
                    </div>
                  </Field>

                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={steps.handlePrevious}
                      className="flex-1 text-muted-foreground"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                      {t("common.back")}
                    </Button>
                    <Button
                      onClick={() => otp.setShowOtpInput(true)}
                      disabled={!form.emailUsername}
                      className="flex-1"
                    >
                      {t("common.continue")}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader className="space-y-2 mb-6 text-center">
                    <DialogTitle className="text-xl text-center">
                      {t("modals.otp.verifyEmail")}
                    </DialogTitle>
                    <DialogDescription className="text-center">
                      {t("modals.otp.description", { email: `${form.emailUsername}@gmail.com` })}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex justify-center mb-6">
                    <InputOTP
                      maxLength={OTP_LENGTH}
                      value={otp.otpValue}
                      onChange={(value) => {
                        otp.setOtpValue(value);
                        if (value.length === OTP_LENGTH) {
                          otp.handleOtpComplete(value);
                        }
                      }}
                      disabled={otp.isVerifying}
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

                  {otp.isVerifying ? (
                    <p className="text-center text-sm font-medium text-foreground">
                      {t("modals.otp.verifying")}
                    </p>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      {t("modals.otp.enterCode")}
                    </p>
                  )}

                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        otp.resetOtp();
                        otp.setShowOtpInput(false);
                      }}
                      className="w-full"
                      disabled={otp.isVerifying}
                    >
                      {t("modals.otp.changeEmail")}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </div>
          )}

          {/* Step 3: Faculty & First Year Selection */}
          {steps.currentStep === 2 && (
            <div className="flex flex-col">
              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">
                  {t("modals.profile.title")}
                </DialogTitle>
                <DialogDescription className="text-center">
                  {t("modals.profile.description")}
                </DialogDescription>
              </DialogHeader>

              <FieldGroup className="mb-6">
                {/* Faculty Selection */}
                <Field>
                  <FieldLabel htmlFor="faculty-select" className="text-sm font-medium text-foreground">
                    {t("settings.profile.faculty")}
                  </FieldLabel>
                  <Select value={form.selectedFaculty} onValueChange={form.setSelectedFaculty}>
                    <SelectTrigger id="faculty-select" className="w-full">
                      <SelectValue placeholder={t("modals.profile.title")} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFaculties.map((faculty) => {
                        const facultyKey = toFacultyKey(faculty);
                        const translationKey = `onboarding.faculties.${facultyKey === 'appliedhealthsciences' ? 'appliedHealthSciences' : facultyKey}`;
                        return (
                          <SelectItem key={faculty} value={faculty}>
                            {t(translationKey) || faculty}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </Field>

                {/* First Year Question */}
                <Field>
                  <FieldLabel className="text-sm font-medium text-foreground">
                    {t("modals.profile.firstYearQuestion")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => form.setIsFirstYear(true)}
                      variant={form.isFirstYear === true ? "default" : "ghost"}
                      className="flex-1"
                    >
                      {t("common.yes")}
                    </Button>
                    <Button
                      onClick={() => form.setIsFirstYear(false)}
                      variant={form.isFirstYear === false ? "default" : "ghost"}
                      className="flex-1"
                    >
                      {t("common.no")}
                    </Button>
                  </div>
                </Field>
              </FieldGroup>

              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={steps.handlePrevious}
                  className="flex-1 text-muted-foreground"
                >
                  <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                  {t("common.back")}
                </Button>
                <LoadingButton
                  onClick={handleNext}
                  disabled={!form.selectedFaculty || form.isFirstYear === null}
                  className="flex-1"
                  isLoading={isNextLoading}
                  loadingText={t("common.pleaseWait") || "Please wait..."}
                >
                  {t("common.continue")}
                </LoadingButton>
              </DialogFooter>
            </div>
          )}

          {/* Step 4: Interests */}
          {steps.currentStep === 3 && (
            <div className="flex flex-col">
              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">
                  {t("settings.profile.selectInterests")}
                </DialogTitle>
                <DialogDescription className="text-center">
                  {t("modals.interests.description")}
                </DialogDescription>
              </DialogHeader>

              <Field className="mb-6">
                <FieldLabel className="text-sm font-medium text-foreground sr-only">
                  {t("settings.profile.interests")}
                </FieldLabel>
                <MultiSelect
                  options={getAvailableInterests()}
                  selected={form.selectedInterests}
                  onToggle={form.toggleInterest}
                  translationKeyPrefix="categories"
                />
              </Field>

              <DialogFooter className="flex flex-col gap-2 sm:flex-col">
                <div className="flex flex-row gap-2 w-full">
                  <Button
                    variant="secondary"
                    onClick={steps.handlePrevious}
                    className="flex-1 text-muted-foreground"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1 text-muted-foreground" />
                    {t("common.back")}
                  </Button>
                  <LoadingButton
                    onClick={handleNext}
                    className="flex-1"
                    disabled={form.selectedInterests.length === 0}
                    isLoading={isNextLoading}
                    loadingText={t("common.pleaseWait") || "Please wait..."}
                  >
                    {t("common.continue")}
                  </LoadingButton>
                </div>
              </DialogFooter>
            </div>
          )}

          {/* Step 5: All Set */}
          {steps.currentStep === 4 && (
            <div className="flex flex-col items-center text-center">
              {/* Success Icon */}
              <div className="relative mb-4">
                <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                  <Check className="w-8 h-8 text-success-foreground" strokeWidth={3} />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-primary-foreground" />
                </div>
              </div>

              <DialogHeader className="space-y-2 mb-6 text-center">
                <DialogTitle className="text-xl text-center">{t("modals.allSet.title")}</DialogTitle>
                <DialogDescription className="text-center">
                  {t("modals.allSet.description")}
                </DialogDescription>
              </DialogHeader>

              {/* Summary */}
              {(form.emailUsername || form.selectedFaculty || form.selectedInterests.length > 0) && (
                <div className="w-full rounded-xl p-4 mb-6 text-left text-sm bg-muted">
                  {form.emailUsername && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">{t("settings.profile.email")}:</span>{" "}
                      {form.emailUsername}@gmail.com
                    </p>
                  )}
                  {form.selectedFaculty && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">{t("settings.profile.faculty")}:</span>{" "}
                      {form.selectedFaculty}
                    </p>
                  )}
                  {form.isFirstYear !== null && (
                    <p className="mb-1 text-foreground">
                      <span className="text-muted-foreground">{t("modals.allSet.year")}:</span>{" "}
                      {form.isFirstYear ? t("modals.allSet.firstYear") : t("modals.allSet.returningStudent")}
                    </p>
                  )}
                  {form.selectedInterests.length > 0 && (
                    <p className="text-foreground">
                      <span className="text-muted-foreground">{t("modals.allSet.interests")}:</span>{" "}
                      {form.selectedInterests.map((interest) => translateInterest(interest, t)).join(", ")}
                    </p>
                  )}
                </div>
              )}

              <DialogFooter>
                <LoadingButton onClick={handleNext} className="w-full" isLoading={isNextLoading} loadingText={t("common.pleaseWait") || "Please wait..."}>
                  {t("modals.allSet.startExploring")}
                </LoadingButton>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingModal;
