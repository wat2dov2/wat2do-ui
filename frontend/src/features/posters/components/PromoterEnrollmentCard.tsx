import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { usePromoterEnrollment } from "@/features/posters/hooks/usePromoterEnrollment";
import { usePromoterState } from "@/features/posters/hooks/usePromoterState";
import { appendSafeReturnTo } from "@/features/auth";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { ROUTES, SETTINGS_TABS, settingsTabPath } from "@/shared/constants/routes";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { ExternalLink, QrCode } from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
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
          <Button asChild className="w-full">
            <Link href={appendSafeReturnTo(ROUTES.LOGIN, ROUTES.PROMOTE)}>
              {t("posters.enrollment.signInToJoin")}
            </Link>
          </Button>
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
          <Button asChild variant="secondary" className="w-full">
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
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("posters.enrollment.enrolledTitle")}</CardTitle>
            <Badge variant="secondary">{t("posters.enrollment.enrolled")}</Badge>
          </div>
          <CardDescription>
            {promoter.hasCurrentTerms
              ? t("posters.enrollment.enrolledDescription")
              : t("posters.enrollment.termsUpdateDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href={ROUTES.POSTERS}>
              <QrCode />
              {t("posters.enrollment.openPosters")}
            </Link>
          </Button>
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
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            {promoter.isEnrolled
              ? t("posters.enrollment.settingsTitle")
              : t("posters.enrollment.joinTitle")}
          </CardTitle>
          {promoter.isEnrolled && (
            <Badge variant="secondary">{t("posters.enrollment.enrolled")}</Badge>
          )}
        </div>
        <CardDescription>
          {promoter.isEnrolled
            ? t("posters.enrollment.settingsDescription")
            : t("posters.enrollment.joinDescription")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
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
              <AlertTitle>{t("posters.enrollment.termsUpdateTitle")}</AlertTitle>
              <AlertDescription>
                {t("posters.enrollment.termsUpdateDescription")}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="promoter-payout-email">
              {t("posters.enrollment.payoutEmail")}
            </Label>
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
            <p className="text-xs text-muted-foreground">
              {t("posters.enrollment.payoutEmailDescription")}
            </p>
          </div>

          {requiresTermsAcceptance && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="promoter-terms"
                data-testid="promoter-terms-checkbox"
                checked={acceptTerms}
                onCheckedChange={(checked) => setAcceptTerms(checked === true)}
              />
              <Label
                htmlFor="promoter-terms"
                className="block text-sm leading-relaxed"
              >
                {t("posters.enrollment.acceptTermsPrefix")}{" "}
                <Link href={ROUTES.PROMOTER_TERMS}>
                  {t("posters.enrollment.termsLink", {
                    version: promoterProgram.tosVersion,
                  })}
                </Link>
              </Label>
            </div>
          )}

          {enrollment.error && (
            <p className="text-sm text-destructive" role="status">
              {getApiErrorMessage(
                enrollment.error,
                t("posters.enrollment.error"),
              )}
            </p>
          )}

          {mode === "recruitment" && (
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>{t("posters.enrollment.trustMonthly")}</li>
              <li>{t("posters.enrollment.trustActivation")}</li>
              <li>{t("posters.enrollment.trustTraffic")}</li>
              <li>{t("posters.enrollment.trustPrivacy")}</li>
            </ul>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <LoadingButton
            type="submit"
            data-testid="promoter-enrollment-submit"
            isLoading={enrollment.isPending}
            disabled={
              !payoutEmail.trim() ||
              (requiresTermsAcceptance && !acceptTerms)
            }
            className="w-full"
          >
            {promoter.isEnrolled
              ? t("posters.enrollment.save")
              : t("posters.enrollment.join")}
          </LoadingButton>
          <Button asChild variant="secondary" className="w-full">
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
            <Button asChild variant="ghost" className="w-full">
              <Link href={ROUTES.POSTERS}>
                {t("posters.enrollment.openPosters")}
              </Link>
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
