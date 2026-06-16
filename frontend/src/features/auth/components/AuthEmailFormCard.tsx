import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Input } from "@/shared/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/ui/input-otp";

interface AuthEmailFormCardProps {
  email: string;
  otpToken: string;
  emailSent: boolean;
  onEmailChange: (value: string) => void;
  onOtpChange: (value: string) => void;
  onContinue: () => void;
  onResend: () => void;
  canContinue: boolean;
  isLoading: boolean;
  error: string | null;
  isEmailPrefilled?: boolean;
}

export function AuthEmailFormCard({
  email,
  otpToken,
  emailSent,
  onEmailChange,
  onOtpChange,
  onContinue,
  onResend,
  canContinue,
  isLoading,
  error,
  isEmailPrefilled = false,
}: AuthEmailFormCardProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-4">
      {!emailSent ? (
        <>
          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
              {t("auth.emailLabel") || "Email address"}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
              disabled={isEmailPrefilled}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <LoadingButton
            type="button"
            onMouseDown={onContinue}
            disabled={!canContinue}
            isLoading={isLoading}
            loadingText={t("common.pleaseWait")}
            className="w-full"
          >
            {t("auth.continue") || "Continue"}
          </LoadingButton>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground mb-2">
              {t("auth.otpDescription", { email }) || `We sent a code to ${email}.`}
            </p>
            <div className="flex justify-center py-2">
              <InputOTP
                id="otp"
                maxLength={6}
                value={otpToken}
                onChange={onOtpChange}
                disabled={isLoading}
                autoFocus
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
          </div>



          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <LoadingButton
            type="button"
            onMouseDown={onContinue}
            disabled={!canContinue}
            isLoading={isLoading}
            loadingText={t("common.pleaseWait")}
            className="w-full"
          >
            {t("auth.verifyOtp") || "Verify code"}
          </LoadingButton>

          <div className="flex flex-col items-center space-y-2 pt-2">
            <button
              type="button"
              onClick={onResend}
              disabled={isLoading}
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              {t("auth.resendOtp") || "Resend code"}
            </button>
          </div>
        </>
      )}

      <p className="text-[11px] text-center text-muted-foreground">
        {t("auth.termsNotice")}
      </p>
    </div>
  );
}
