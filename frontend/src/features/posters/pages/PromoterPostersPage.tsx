import { useMemo } from "react";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { ROUTES } from "@/shared/constants/routes";
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
  Section,
  Stack,
} from "@/shared/layout";
import { EmptyState } from "@/shared/feedback";
import { PosterMapSkeleton } from "@/features/posters/components/PosterMapSkeleton";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Link } from "@/shared/ui/link";
import { LoadingPage } from "@/shared/ui/loading-page";
import { StatCard } from "@/shared/ui/stat-card";
import { Coins, DollarSign, MapPin, QrCode, ShieldAlert, Users } from "lucide-react";
import { formatCents } from "@/shared/utils/currency";

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
          <PageShellHeader route={ROUTES.POSTERS} description={t("posters.dashboard.enrollmentRequired")} />
          <PromoterEnrollmentCard mode="recruitment" />
        </Stack>
      </Container>
    );
  }

  const earnings = dashboard.earnings.data;
  const programEnabled = promoter.isProgramEnabled && earnings?.programEnabled;
  const canCreatePosters = Boolean(
    earnings && programEnabled && promoter.school &&
    earnings.activeSlotsUsed < earnings.activeSlotsLimit,
  );
  const summary = [
    {
      key: "pending",
      icon: DollarSign,
      label: t("posters.dashboard.pendingEarnings"),
      value: earnings ? formatCents(earnings.pendingCents, "cad", i18n.language) : null,
    },
    {
      key: "visitors",
      icon: Users,
      label: t("posters.dashboard.creditableVisitors"),
      value: earnings ? String(earnings.periodCreditableVisitors) : null,
    },
    {
      key: "unqualified",
      icon: ShieldAlert,
      label: t("posters.dashboard.unqualifiedScans"),
      value: earnings ? String(earnings.periodUnqualifiedScans) : null,
    },
    {
      key: "paid",
      icon: Coins,
      label: t("posters.dashboard.lifetimePaid"),
      value: earnings ? formatCents(earnings.lifetimePaidCents, "cad", i18n.language) : null,
    },
    {
      key: "slots",
      icon: QrCode,
      label: t("posters.dashboard.activeSlots"),
      value: earnings ? t("posters.dashboard.slotValue", {
        used: earnings.activeSlotsUsed,
        limit: earnings.activeSlotsLimit,
      }) : null,
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
        <PageShellHeader
          route={ROUTES.POSTERS}
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
            earnings && earnings.posters.length > 0 && canCreatePosters ? (
              <PromoterPosterCreator
                school={promoter.school ?? ""}
                activeSlotsUsed={earnings.activeSlotsUsed}
                activeSlotsLimit={earnings.activeSlotsLimit}
              />
            ) : undefined
          }
        />

        {dashboard.earnings.isError && (
          <Alert variant="destructive">
            <QrCode />
            <AlertTitle>{t("posters.dashboard.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t("posters.dashboard.loadErrorDescription")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void dashboard.earnings.refetch()}
              >
                {t("common.tryAgain")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {earnings && !programEnabled && (
          <Alert variant="info" data-testid="promoter-program-paused">
            <QrCode />
            <AlertTitle>{t("posters.dashboard.pausedTitle")}</AlertTitle>
            <AlertDescription>
              {t("posters.dashboard.pausedDescription")}
            </AlertDescription>
          </Alert>
        )}

        {(earnings || dashboard.earnings.isLoading) && <FormGrid columns={2} collapse={false}>
          {summary.map(({ key, icon, label, value }) => (
            <StatCard
              key={key}
              icon={icon}
              label={label}
              value={value}
              note={key === "slots" ? undefined : t("posters.dashboard.updatedDaily")}
            />
          ))}
        </FormGrid>}

        <Section
          title={t("posters.inventory.title")}
          description={t("posters.inventory.description", {
            days: promoterProgram.quietPosterDays,
          })}
        >
          {!earnings ? (
            dashboard.earnings.isLoading ? <LoadingPage variant="cards" /> : null
          ) : earnings.posters.length === 0 ? (
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
            <PosterMapSkeleton height="480px" />
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
          {dashboard.payouts.isError ? (
            <Alert variant="warning">
              <Coins />
              <AlertTitle>{t("posters.payouts.loadErrorTitle")}</AlertTitle>
              <AlertDescription>
                {t("posters.payouts.loadErrorDescription")}
              </AlertDescription>
            </Alert>
          ) : (
            <PromoterPayoutHistory payouts={dashboard.payouts.data ?? []} isLoading={dashboard.payouts.isLoading} />
          )}
        </Section>
      </Stack>
    </Container>
  );
}
