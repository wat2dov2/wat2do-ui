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
import { GoogleLogo } from "@/shared/ui/google-logo";
import { useTranslation } from "react-i18next";
import { sanitizeEmailUsername } from "@/shared/utils/string";
import { OTP_LENGTH } from "@/features/auth/constants";

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
          <GoogleLogo />
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
              onChange={(e) => onEmailUsernameChange(sanitizeEmailUsername(e.target.value))}
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
          maxLength={OTP_LENGTH}
          value={otpValue}
          onChange={(value) => {
            onOtpValueChange(value);
            if (value.length === OTP_LENGTH) {
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
