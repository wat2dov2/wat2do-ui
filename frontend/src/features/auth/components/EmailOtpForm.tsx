import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  useEmailOtpFlow,
  type VerifiedOtpSession,
} from "@/features/auth/hooks/useEmailOtpFlow";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/ui/input-otp";
import { LoadingButton } from "@/shared/ui/loading-button";
import { cn } from "@/shared/lib/utils";
import {
  getCurrentSchool,
  resolveSchool,
} from "@/shared/constants/schools";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";

interface EmailOtpFormProps
  extends Omit<ComponentProps<"form">, "onSubmit"> {
  actionLabel?: string;
  requestCodeLabel?: string;
  initialEmail?: string;
  school?: string | null;
  invitationToken?: string;
  returnTo?: string;
  isEmailLocked?: boolean;
  isVerificationDisabled?: boolean;
  requestFooter?: ReactNode;
  footer?: ReactNode;
  onAuthenticated: (
    session: VerifiedOtpSession,
    email: string,
  ) => void | Promise<void>;
}

export function EmailOtpForm({
  actionLabel,
  requestCodeLabel,
  initialEmail,
  school,
  invitationToken,
  returnTo,
  isEmailLocked = false,
  isVerificationDisabled = false,
  requestFooter,
  footer,
  onAuthenticated,
  className,
  children,
  ...props
}: EmailOtpFormProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [hostnameSchool, setHostnameSchool] = useState<string | null>(null);
  const [isCompletingAction, setIsCompletingAction] = useState(false);
  const { schoolBySlug } = useSchoolDirectory();
  const flow = useEmailOtpFlow({
    initialEmail,
    invitationToken,
    returnTo,
  });
  const emailId = `${fieldId}-email`;
  const otpId = `${fieldId}-otp`;
  const isBusy = flow.isLoading || isCompletingAction;
  const resolvedRequestCodeLabel = requestCodeLabel ?? t("auth.continue");
  const resolvedActionLabel = actionLabel ?? t("auth.verifyOtp");
  const schoolSlug =
    school || hostnameSchool ? resolveSchool(school ?? hostnameSchool) : "";
  const emailDomain =
    schoolBySlug.get(schoolSlug)?.email_domains?.[0] ?? "school.edu";

  useEffect(() => {
    setHostnameSchool(getCurrentSchool());
  }, []);

  // On touch devices autofocus pops the keyboard and scrolls/scales the page
  // into the field the moment the drawer opens, before the user has decided to
  // type. Desktop keeps it so the form is usable straight from the keyboard.
  const autoFocusFields = !useCoarsePointer();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    const session = await flow.onSubmit();
    if (!session) {
      return;
    }

    setIsCompletingAction(true);
    try {
      await onAuthenticated(session, flow.email.trim());
    } finally {
      setIsCompletingAction(false);
    }
  };

  return (
    <form
      data-slot="email-otp-form"
      className={cn("w-full", className)}
      onSubmit={(event) => void handleSubmit(event)}
      {...props}
    >
      <FieldSet disabled={isBusy} className="gap-4">
        {!flow.emailSent ? (
          <Field>
            <FieldLabel htmlFor={emailId}>{t("auth.emailLabel")}</FieldLabel>
            <Input
              id={emailId}
              type="email"
              value={flow.email}
              onChange={(event) => flow.onEmailChange(event.target.value)}
              placeholder={t("auth.emailPlaceholder", {
                domain: emailDomain,
              })}
              disabled={isEmailLocked || isBusy}
              autoComplete="email"
              autoFocus={autoFocusFields}
              required
            />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor={otpId}>{t("auth.otpLabel")}</FieldLabel>
            <FieldDescription>
              {t("auth.otpDescription", { email: flow.email.trim() })}
            </FieldDescription>
            <Stack align="center">
              <InputOTP
                id={otpId}
                maxLength={6}
                value={flow.otpToken}
                onChange={flow.onOtpChange}
                disabled={isBusy}
                autoComplete="one-time-code"
                aria-label={t("auth.otpLabel")}
                autoFocus
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </Stack>
          </Field>
        )}

        {children}

        <FieldError>{flow.error}</FieldError>

        <LoadingButton
          type="submit"
          disabled={
            !flow.isFormValid ||
            (flow.emailSent && isVerificationDisabled)
          }
          isLoading={isBusy}
          className="w-full"
        >
          {flow.emailSent
            ? resolvedActionLabel
            : resolvedRequestCodeLabel}
        </LoadingButton>

        {flow.emailSent ? (
          <Stack align="center" gap={2}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void flow.onResend()}
              disabled={isBusy}
            >
              {t("auth.resendOtp")}
            </Button>
          </Stack>
        ) : null}

        {!flow.emailSent ? requestFooter : null}
        {footer}
      </FieldSet>
    </form>
  );
}
