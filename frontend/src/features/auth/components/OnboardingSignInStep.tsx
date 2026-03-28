/**
 * Sign-in step component for onboarding
 */

import { Input } from "@/shared/ui/input";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Button } from "@/shared/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/ui/input-otp";
import { OnboardingStepWrapper } from "@/features/auth/components/OnboardingStepWrapper";
import { useTranslation } from "react-i18next";

interface OnboardingSignInStepProps {
  emailUsername: string;
  onEmailUsernameChange: (value: string) => void;
  showOtpInput: boolean;
  otpValue: string;
  isVerifying: boolean;
  onOtpValueChange: (value: string) => void;
  onOtpComplete: (value: string) => void;
  onShowOtpInput: (show: boolean) => void;
  onResetOtp: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function OnboardingSignInStep({
  emailUsername,
  onEmailUsernameChange,
  showOtpInput,
  otpValue,
  isVerifying,
  onOtpValueChange,
  onOtpComplete,
  onShowOtpInput,
  onResetOtp,
  onPrevious,
  onNext,
}: OnboardingSignInStepProps) {
  const { t } = useTranslation();

  if (!showOtpInput) {
    return (
      <OnboardingStepWrapper
        title={t("modals.signIn.title")}
        description={t("modals.signIn.description")}
        onPrevious={onPrevious}
        onNext={() => onShowOtpInput(true)}
        nextDisabled={!emailUsername}
      >
        <button
          onClick={() => {
            onEmailUsernameChange("demo.user");
            onNext();
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

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">{t("common.or")}</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Field className="mb-4">
          <FieldLabel htmlFor="email-username" className="text-sm font-medium text-foreground">
            {t("settings.profile.email")}
          </FieldLabel>
          <div className="flex items-center">
            <Input
              id="email-username"
              type="text"
              value={emailUsername}
              onChange={(e) => onEmailUsernameChange(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
              placeholder={t("modals.signIn.username")}
              className="flex-1 h-10 text-sm rounded-l-md rounded-r-none border-r-0"
            />
            <div className="h-10 px-3 flex items-center text-sm font-medium rounded-r-md border border-l-0 border-border bg-muted text-muted-foreground">
              @gmail.com
            </div>
          </div>
        </Field>
      </OnboardingStepWrapper>
    );
  }

  return (
    <OnboardingStepWrapper
      title={t("modals.otp.verifyEmail")}
      description={t("modals.otp.description", { email: `${emailUsername}@gmail.com` })}
      showBack={false}
    >
      <div className="flex justify-center mb-6">
        <InputOTP
          maxLength={6}
          value={otpValue}
          onChange={(value) => {
            onOtpValueChange(value);
            if (value.length === 6) {
              onOtpComplete(value);
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
          {t("modals.otp.verifying")}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {t("modals.otp.enterCode")}
        </p>
      )}

      <div className="mt-4">
        <Button
          variant="secondary"
          onClick={() => {
            onResetOtp();
            onShowOtpInput(false);
          }}
          className="w-full"
          disabled={isVerifying}
        >
          {t("modals.otp.changeEmail")}
        </Button>
      </div>
    </OnboardingStepWrapper>
  );
}
