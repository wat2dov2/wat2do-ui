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
import { availableInterests } from "@/shared/data/interests";
import { updateUserProfile } from "@/features/auth/api/auth.api";
import { availableSchools } from "@/shared/constants/schools";
import { translateInterest } from "@/shared/utils/translateInterest";

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

const GOOSE_IMAGE_URL =
  "https://lh3.googleusercontent.com/rd-gg-dl/ABS2GSnULbbntBOQGWx17qUnha4hcyKXW4asH7zxR0zV3dANdBEYPEagYhHMszDOKX9O5kdpGZzZIFkeec9LyOLiy1zV2IvIbdipr-2UrDPSBEmaOUGefddFgFNJWzaLGire29cPMIU0ypmBaj88c5EJ8EJyZt6fv3xo0Y-LV-R7d96pf6Ig6GCvFgAkIpFOZqGQ0z6wpSfun0c8OZi-4oQJziK2vs3gVWP7UN_aeImAe_lWlxpy47iTUzRShknBpGNPtDEMk9x3RZdzYuU21tbT4lQZHL2pdA6oAwppje-Id8aceQu0b4Legme-nb60_-0oQJHJ0bWVgfu3lMwQ_tZjGQBFF8UNt92y17hbrE92eIyFLnxxHGVR43X9aeIukNwVlx-zIZXzWSkv2Xe0CGkViJ2MmCOHEWwAQoaIDi86f7uMn97bg-i7_7cO4cR5snB574v-s94b3KSg-XoqNUxiAkZgRqITK9Rx8YaRxZMuqfRb0nBjaA1iWhP8ln24wKfrugS5X8dJFpExxq-wQhh7zvjFcbVjdI-G9dUaBtji5UjCJUu5Y_HYMu9BfNTvAMAC6KRimkLHoue_biInFKWdwpr77m6t48XH3Psohdg11Jx-d5zaTjASWfUgm_pSqDADN0EJnRqkVZiDCJgmk1zWpkdmWbpq_iFfTQE7kLv5xKEQw9QIGlfBISP98XHpcK_A4JyTd20pKASFWjfGD1zK6S3HfznvUW3qqpbjdE15rDZa0qsGqaImOVLjIAXEehfcl-o-w6EWMXcpPS283P3S3mkh7J7X2J0bL3hE3z6kPt81SHPuZzifLqQmR237Q9DjtsUoLZpHY-u_um2-JpdGbygK6m5geh_c4Gxm-4FQ75ksSSh12c0gGI9n6Wtbt0dclDyno-RgNzEinsI1bt_5UYQyvsxtGo98BEWwYzfc70_2JGyElBxCVuM_SU2Jva19sKtekc1SoDAQgOixWsmchfnna83xk64CQ-TGm_AgB97ZjxqbpDlRYAL-CNa7bzGecRhhoZVOb840TJ-62vulNL2CPFG0fG5e2uaNGMo6q6WAa20K6fmY4_fPYBOTm3DGryIPPWMAatdv3Pp6BhjZJuWsLkxInyyy_ixin38D53OXfzg9ZCEqIJRudGCgF-VrtwW1V4SeP3PMch0dAzCqL4NUe2p29STX1Xeh-Ypvzs0kjqSNQaRPq9g=s1024-rj";

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
            school: availableSchools[0] || "University of Waterloo",
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
                        onChange={(e) => form.setEmailUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
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
                      maxLength={6}
                      value={otp.otpValue}
                      onChange={(value) => {
                        otp.setOtpValue(value);
                        if (value.length === 6) {
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
                        const facultyKey = faculty.toLowerCase().replace(/\s+/g, '');
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
                  options={availableInterests}
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
