import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PromoterEnrollmentCard } from "@/features/posters/components/PromoterEnrollmentCard";
import { QRScanMap } from "@/features/posters/components/QRScanMap";
import {
  useCampusCoverage,
  usePromoterDashboard,
} from "@/features/posters/hooks/usePromoterDashboard";
import { usePromoterState } from "@/features/posters/hooks/usePromoterState";
import {
  buildCoverageMapMarkers,
  buildOwnedPosterMapMarkers,
} from "@/features/posters/utils/posterMapMarkers";
import { PromoterPayoutHistory } from "@/features/posters/components/PromoterPayoutHistory";
import { PromoterPosterCreator } from "@/features/posters/components/PromoterPosterCreator";
import { PromoterPosterInventory } from "@/features/posters/components/PromoterPosterInventory";
import { promoterProgram } from "@/shared/config/promoterProgram";
import {
  Container,
  FormGrid,
  PageHeader,
  Section,
  Stack,
} from "@/shared/layout";
import { EmptyState, LoadingState } from "@/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Link } from "@/shared/ui/link";
import { LoadingPage } from "@/shared/ui/loading-page";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/shared/ui/card";
import {
  Coins,
  DollarSign,
  MapPin,
  QrCode,
  ShieldAlert,
  Users,
} from "@/shared/ui/doodle-icons";
import { formatCadCents } from "@/shared/utils/currency";

export function PromoterPostersPage() {
  const { t, i18n } = useTranslation();
  const promoter = usePromoterState();
  const dashboard = usePromoterDashboard(
    promoter.isEnrolled ? promoter.userId : null,
  );
  const coverage = useCampusCoverage(promoter.school);

  const markers = useMemo(
    () => [
      ...buildCoverageMapMarkers(coverage.data),
      ...buildOwnedPosterMapMarkers(dashboard.earnings.data?.posters ?? []),
    ],
    [coverage.data, dashboard.earnings.data?.posters],
  );

  if (!promoter.isEnrolled) {
    return (
      <Container size="sm" data-testid="promoter-dashboard">
        <Stack gap={6}>
          <PageHeader
            title={t("posters.dashboard.title")}
            description={t("posters.dashboard.enrollmentRequired")}
          />
          <PromoterEnrollmentCard mode="recruitment" />
        </Stack>
      </Container>
    );
  }

  if (dashboard.earnings.isLoading) {
    return <LoadingPage className="min-h-[60dvh]" />;
  }

  if (dashboard.earnings.isError || !dashboard.earnings.data) {
    return (
      <Container size="sm" data-testid="promoter-dashboard">
        <Alert variant="destructive">
          <QrCode />
          <AlertTitle>{t("posters.dashboard.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("posters.dashboard.loadErrorDescription")}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void dashboard.earnings.refetch()}
            >
              {t("common.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      </Container>
    );
  }

  const earnings = dashboard.earnings.data;
  const programEnabled = promoter.isProgramEnabled && earnings.programEnabled;
  const canCreatePosters =
    programEnabled &&
    Boolean(promoter.school) &&
    earnings.activeSlotsUsed < earnings.activeSlotsLimit;
  const summary = [
    {
      key: "pending",
      icon: DollarSign,
      label: t("posters.dashboard.pendingEarnings"),
      value: formatCadCents(earnings.pendingCents, i18n.language),
    },
    {
      key: "visitors",
      icon: Users,
      label: t("posters.dashboard.creditableVisitors"),
      value: String(earnings.periodCreditableVisitors),
    },
    {
      key: "unqualified",
      icon: ShieldAlert,
      label: t("posters.dashboard.unqualifiedScans"),
      value: String(earnings.periodUnqualifiedScans),
    },
    {
      key: "paid",
      icon: Coins,
      label: t("posters.dashboard.lifetimePaid"),
      value: formatCadCents(earnings.lifetimePaidCents, i18n.language),
    },
    {
      key: "slots",
      icon: QrCode,
      label: t("posters.dashboard.activeSlots"),
      value: t("posters.dashboard.slotValue", {
        used: earnings.activeSlotsUsed,
        limit: earnings.activeSlotsLimit,
      }),
    },
  ];

  const handleMarkerClick = (posterId: string) => {
    document.getElementById(`poster-${posterId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  return (
    <Container data-testid="promoter-dashboard">
      <Stack gap={8}>
        <PageHeader
          title={t("posters.dashboard.title")}
          description={
            <>
              {t("posters.dashboard.description")}{" "}
              <Link
                href={promoterProgram.discordInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("posters.dashboard.discordHelp")}
              </Link>
            </>
          }
          actions={
            earnings.posters.length > 0 && canCreatePosters ? (
              <PromoterPosterCreator
                school={promoter.school ?? ""}
                activeSlotsUsed={earnings.activeSlotsUsed}
                activeSlotsLimit={earnings.activeSlotsLimit}
              />
            ) : undefined
          }
        />

        {!programEnabled && (
          <Alert variant="info" data-testid="promoter-program-paused">
            <QrCode />
            <AlertTitle>{t("posters.dashboard.pausedTitle")}</AlertTitle>
            <AlertDescription>
              {t("posters.dashboard.pausedDescription")}
            </AlertDescription>
          </Alert>
        )}

        <FormGrid columns={2} collapse={false}>
          {summary.map(({ key, icon: Icon, label, value }) => (
            <Card key={key}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardAction>
                  <Icon className="size-5 text-primary" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <Stack gap={1}>
                  <p className="text-2xl font-semibold text-foreground">
                    {value}
                  </p>
                  {key !== "slots" && (
                    <p className="text-xs text-muted-foreground">
                      {t("posters.dashboard.updatedDaily")}
                    </p>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </FormGrid>

        <Section
          title={t("posters.inventory.title")}
          description={t("posters.inventory.description", {
            days: promoterProgram.quietPosterDays,
          })}
        >
          {earnings.posters.length === 0 ? (
            <EmptyState
              icon={<MapPin />}
              title={t("posters.inventory.emptyTitle")}
              description={t("posters.inventory.emptyDescription")}
              action={
                canCreatePosters ? (
                  <PromoterPosterCreator
                    school={promoter.school ?? ""}
                    activeSlotsUsed={earnings.activeSlotsUsed}
                    activeSlotsLimit={earnings.activeSlotsLimit}
                  />
                ) : undefined
              }
            />
          ) : (
            <PromoterPosterInventory posters={earnings.posters} />
          )}
        </Section>

        <Section
          title={t("posters.dashboard.mapTitle")}
          description={t("posters.dashboard.mapDescription")}
        >
          {coverage.isLoading ? (
            <LoadingState label={t("posters.map.loading")} />
          ) : (
            <QRScanMap
              markers={markers}
              height="480px"
              onMarkerClick={handleMarkerClick}
            />
          )}
        </Section>

        <Section
          title={t("posters.payouts.title")}
          description={t("posters.payouts.description")}
        >
          {dashboard.payouts.isLoading ? (
            <LoadingState label={t("posters.payouts.loading")} />
          ) : dashboard.payouts.isError ? (
            <Alert variant="warning">
              <Coins />
              <AlertTitle>{t("posters.payouts.loadErrorTitle")}</AlertTitle>
              <AlertDescription>
                {t("posters.payouts.loadErrorDescription")}
              </AlertDescription>
            </Alert>
          ) : (
            <PromoterPayoutHistory payouts={dashboard.payouts.data ?? []} />
          )}
        </Section>
      </Stack>
    </Container>
  );
}
