import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { PromoterTermsDialog } from "@/features/posters/components/PromoterTermsDialog";
import { usePromoterEnrollment } from "@/features/posters/hooks/usePromoterEnrollment";
import { usePromoterState } from "@/features/posters/hooks/usePromoterState";
import { appendSafeReturnTo } from "@/features/auth";
import { promoterProgram } from "@/shared/config/promoterProgram";
import {
  ROUTES,
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
import { Link } from "@/shared/ui/link";
import { LoadingButton } from "@/shared/ui/loading-button";

interface PromoterEnrollmentCardProps {
  mode: "recruitment" | "settings";
  onEnrolled?: () => void;
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
  const requiresTermsAcceptance =
    !promoter.isEnrolled || !promoter.hasCurrentTerms;

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
      <Card data-testid="promoter-enrollment-signed-out">
        <CardHeader>
          <CardTitle>{t("posters.enrollment.readyTitle")}</CardTitle>
          <CardDescription>
            {t("posters.enrollment.readyDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Stack grow>
            <Button asChild>
              <Link href={appendSafeReturnTo(ROUTES.LOGIN, ROUTES.PROMOTE)}>
                {t("posters.enrollment.signInToJoin")}
              </Link>
            </Button>
          </Stack>
        </CardFooter>
      </Card>
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
          <Stack grow>
            <Button asChild variant="secondary">
              <Link href={settingsTabPath(SETTINGS_TABS.PROFILE)}>
                {t("posters.enrollment.completeProfile")}
              </Link>
            </Button>
          </Stack>
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
            <Badge variant="secondary">
              {t("posters.enrollment.enrolled")}
            </Badge>
          </CardAction>
          <CardDescription>
            {promoter.hasCurrentTerms
              ? t("posters.enrollment.enrolledDescription")
              : t("posters.enrollment.termsUpdateDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Stack grow>
            <Button asChild>
              <Link href={ROUTES.POSTERS}>
                <QrCode />
                {t("posters.enrollment.openPosters")}
              </Link>
            </Button>
          </Stack>
        </CardFooter>
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
    <Card data-testid="promoter-enrollment-form">
      <CardHeader>
        <CardTitle>
          {promoter.isEnrolled
            ? t("posters.enrollment.settingsTitle")
            : t("posters.enrollment.joinTitle")}
        </CardTitle>
        {promoter.isEnrolled && (
          <CardAction>
            <Badge variant="secondary">
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
      <form onSubmit={handleSubmit}>
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

            {!promoter.hasCurrentTerms && promoter.isEnrolled && (
              <Alert variant="warning">
                <QrCode />
                <AlertTitle>
                  {t("posters.enrollment.termsUpdateTitle")}
                </AlertTitle>
                <AlertDescription>
                  {t("posters.enrollment.termsUpdateDescription")}
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

            <Field>
              <FieldDescription>
                {acceptTerms || !requiresTermsAcceptance
                  ? t("posters.enrollment.termsAccepted")
                  : t("posters.enrollment.acceptTermsPrefix")}
              </FieldDescription>
              <Button
                type="button"
                variant="secondary"
                selected={acceptTerms || !requiresTermsAcceptance}
                onClick={() => setTermsOpen(true)}
                data-testid="promoter-terms-open"
              >
                {t("posters.enrollment.termsLink", {
                  version: promoterProgram.tosVersion,
                })}
              </Button>
            </Field>

            {enrollment.error && (
              <FieldError role="status">
                {getApiErrorMessage(
                  enrollment.error,
                  t("posters.enrollment.error"),
                )}
              </FieldError>
            )}

            {mode === "recruitment" && (
              <Stack as="ul" gap={2} className="text-sm text-muted-foreground">
                <li>{t("posters.enrollment.trustMonthly")}</li>
                <li>{t("posters.enrollment.trustActivation")}</li>
                <li>{t("posters.enrollment.trustTraffic")}</li>
                <li>{t("posters.enrollment.trustPrivacy")}</li>
              </Stack>
            )}
          </Stack>
        </CardContent>
        <CardFooter>
          <Stack gap={3} grow>
            <LoadingButton
              type="submit"
              data-testid="promoter-enrollment-submit"
              isLoading={enrollment.isPending}
              disabled={
                !payoutEmail.trim() || (requiresTermsAcceptance && !acceptTerms)
              }
            >
              {promoter.isEnrolled
                ? t("posters.enrollment.save")
                : t("posters.enrollment.join")}
            </LoadingButton>
            <Button asChild variant="secondary">
              <a
                href={promoterProgram.discordInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink />
                {t("posters.enrollment.discord")}
              </a>
            </Button>
            {promoter.isEnrolled && (
              <Button asChild variant="ghost">
                <Link href={ROUTES.POSTERS}>
                  {t("posters.enrollment.openPosters")}
                </Link>
              </Button>
            )}
          </Stack>
        </CardFooter>
      </form>
      <PromoterTermsDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        onAccept={() => setAcceptTerms(true)}
      />
    </Card>
  );
}
