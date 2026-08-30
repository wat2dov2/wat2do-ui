import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { EmailOtpForm } from "@/features/auth";
import { PromoterTermsDialog } from "@/features/posters/components/PromoterTermsDialog";
import { usePromoterEnrollment } from "@/features/posters/hooks/usePromoterEnrollment";
import { usePromoterState } from "@/features/posters/hooks/usePromoterState";
import { promoterProgram } from "@/shared/config/promoterProgram";
import {
  SETTINGS_TABS,
  settingsTabPath,
} from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { ExternalLink, QrCode } from "@/shared/ui/doodle-icons";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";

interface PromoterEnrollmentCardProps {
  mode: "recruitment" | "settings";
  onEnrolled?: () => void;
}

function PromoterTermsField({
  accepted,
  onOpen,
}: {
  accepted: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Field>
      <FieldDescription>
        {accepted
          ? t("posters.enrollment.termsAccepted")
          : t("posters.enrollment.acceptTermsPrefix")}
      </FieldDescription>
      <Button
        type="button"
        variant="outline"
        selected={accepted}
        onClick={onOpen}
        data-testid="promoter-terms-open"
      >
        {t("posters.enrollment.termsLink")}
      </Button>
    </Field>
  );
}

export function PromoterEnrollmentCard({
  mode,
  onEnrolled,
}: PromoterEnrollmentCardProps) {
  const { t } = useTranslation();
  const promoter = usePromoterState();
  const enrollment = usePromoterEnrollment();
  const [payoutEmail, setPayoutEmail] = useState(
    promoter.payoutEmail ?? promoter.userEmail ?? "",
  );
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const requiresTermsAcceptance = !promoter.isEnrolled;
  const termsDialog = (
    <PromoterTermsDialog
      open={termsOpen}
      onOpenChange={setTermsOpen}
      onAccept={
        requiresTermsAcceptance
          ? () => setAcceptTerms(true)
          : undefined
      }
    />
  );

  if (
    !promoter.isProgramEnabled &&
    (mode === "recruitment" || !promoter.isEnrolled)
  ) {
    return (
      <Card data-testid="promoter-enrollment-paused">
        <CardHeader>
          <CardTitle>{t("posters.enrollment.pausedTitle")}</CardTitle>
          <CardDescription>
            {t("posters.enrollment.pausedDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!promoter.isAuthenticated) {
    return (
      <>
        <Card data-testid="promoter-enrollment-signed-out">
          <CardHeader>
            <CardTitle>{t("posters.enrollment.readyTitle")}</CardTitle>
            <CardDescription>
              {t("posters.enrollment.readyDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailOtpForm
              data-testid="promoter-enrollment-auth"
              requestCodeLabel={t("posters.enrollment.join")}
              actionLabel={t("posters.enrollment.join")}
              isSubmitDisabled={!acceptTerms}
              onAuthenticated={async (_session, email) => {
                setPayoutEmail(email);
                try {
                  await enrollment.mutateAsync({
                    payoutEmail: email,
                    acceptTos: true,
                  });
                  setAcceptTerms(false);
                  onEnrolled?.();
                } catch {
                  // The authenticated enrollment form renders the mutation error.
                }
              }}
            >
              <PromoterTermsField
                accepted={acceptTerms}
                onOpen={() => setTermsOpen(true)}
              />
            </EmailOtpForm>
          </CardContent>
        </Card>
        {termsDialog}
      </>
    );
  }

  if (!promoter.school) {
    return (
      <Card data-testid="promoter-enrollment-missing-school">
        <CardHeader>
          <CardTitle>{t("posters.enrollment.schoolRequiredTitle")}</CardTitle>
          <CardDescription>
            {t("posters.enrollment.schoolRequiredDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href={settingsTabPath(SETTINGS_TABS.PROFILE)}>
              {t("posters.enrollment.completeProfile")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (mode === "recruitment" && promoter.isEnrolled) {
    return (
      <Card data-testid="promoter-enrollment-complete">
        <CardHeader>
          <CardTitle>{t("posters.enrollment.enrolledTitle")}</CardTitle>
          <CardAction>
            <Badge variant="success">
              {t("posters.enrollment.enrolled")}
            </Badge>
          </CardAction>
          <CardDescription>
            {t("posters.enrollment.enrolledDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    enrollment.mutate(
      {
        payoutEmail,
        acceptTos: requiresTermsAcceptance ? acceptTerms : false,
      },
      {
        onSuccess: () => {
          setAcceptTerms(false);
          onEnrolled?.();
        },
      },
    );
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <Card data-testid="promoter-enrollment-form">
          <CardHeader>
            <CardTitle>
              {promoter.isEnrolled
                ? t("posters.enrollment.settingsTitle")
                : t("posters.enrollment.joinTitle")}
            </CardTitle>
            {promoter.isEnrolled && (
              <CardAction>
                <Badge variant="success">
                  {t("posters.enrollment.enrolled")}
                </Badge>
              </CardAction>
            )}
            <CardDescription>
              {promoter.isEnrolled
                ? t("posters.enrollment.settingsDescription")
                : t("posters.enrollment.joinDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={5}>
              {!promoter.isProgramEnabled && promoter.isEnrolled && (
                <Alert variant="info">
                  <QrCode />
                  <AlertTitle>{t("posters.enrollment.pausedTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("posters.enrollment.pausedMaintenanceDescription")}
                  </AlertDescription>
                </Alert>
              )}

              <Field>
                <FieldLabel htmlFor="promoter-payout-email">
                  {t("posters.enrollment.payoutEmail")}
                </FieldLabel>
                <Input
                  id="promoter-payout-email"
                  data-testid="promoter-payout-email"
                  type="email"
                  value={payoutEmail}
                  onChange={(event) => setPayoutEmail(event.target.value)}
                  placeholder={t("posters.enrollment.payoutEmailPlaceholder")}
                  autoComplete="email"
                  required
                />
                <FieldDescription>
                  {t("posters.enrollment.payoutEmailDescription")}
                </FieldDescription>
              </Field>

              <PromoterTermsField
                accepted={acceptTerms || !requiresTermsAcceptance}
                onOpen={() => setTermsOpen(true)}
              />

              {enrollment.error && (
                <FieldError role="status">
                  {getApiErrorMessage(
                    enrollment.error,
                    t("posters.enrollment.error"),
                  )}
                </FieldError>
              )}

              {mode === "recruitment" && (
                <CardDescription>
                  <Stack as="ul" gap={2}>
                    <li>{t("posters.enrollment.trustMonthly")}</li>
                    <li>{t("posters.enrollment.trustActivation")}</li>
                    <li>{t("posters.enrollment.trustTraffic")}</li>
                    <li>{t("posters.enrollment.trustPrivacy")}</li>
                  </Stack>
                </CardDescription>
              )}
            </Stack>
          </CardContent>
          <CardFooter>
            <Stack direction="horizontal" gap={3} wrap>
              <LoadingButton
                type="submit"
                data-testid="promoter-enrollment-submit"
                isLoading={enrollment.isPending}
                disabled={
                  !payoutEmail.trim() ||
                  (requiresTermsAcceptance && !acceptTerms)
                }
              >
                {promoter.isEnrolled
                  ? t("posters.enrollment.save")
                  : t("posters.enrollment.join")}
              </LoadingButton>
              <Button asChild variant="outline">
                <a
                  href={promoterProgram.discordInviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink />
                  {t("posters.enrollment.discord")}
                </a>
              </Button>
            </Stack>
          </CardFooter>
        </Card>
      </form>
      {termsDialog}
    </>
  );
}
