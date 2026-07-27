import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { useEventsStore } from "@/features/events";
import { PromoterEnrollmentCard } from "@/features/posters/components/PromoterEnrollmentCard";
import { QRScanMap } from "@/features/posters/components/QRScanMap";
import { useCampusCoverage } from "@/features/posters/hooks/usePromoterDashboard";
import { usePromoterState } from "@/features/posters/hooks/usePromoterState";
import { buildCoverageMapMarkers } from "@/features/posters/utils/posterMapMarkers";
import { promoterProgram } from "@/shared/config/promoterProgram";
import {
  getSchoolDisplayName,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { DollarSign, MapPin, QrCode } from "@/shared/ui/doodle-icons";
import { LoadingState } from "@/shared/feedback";
import { formatCadCents } from "@/shared/utils/currency";

const STEP_ICONS = [QrCode, MapPin, DollarSign] as const;

export function PromotePage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const promoter = usePromoterState();
  const viewedSchool = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(promoter.school, viewedSchool);
  const coverage = useCampusCoverage(school);
  const mapMarkers = useMemo(
    () => buildCoverageMapMarkers(coverage.data),
    [coverage.data],
  );

  return (
    <main className="min-h-screen py-6 sm:py-10" data-testid="promote-page">
      <Container>
        <Stack gap={8}>
          <PageHeader
            title={t("posters.promote.title", {
              school: getSchoolDisplayName(school),
            })}
            description={t("posters.promote.description", {
              rate: formatCadCents(promoterProgram.rateCents, i18n.language),
            })}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            <Stack gap={6} className="order-3 lg:order-1">
              <Section
                title={t("posters.promote.stepsTitle")}
                description={t("posters.promote.stepsDescription")}
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  {[1, 2, 3].map((step, index) => {
                    const Icon = STEP_ICONS[index];
                    return (
                      <Card key={step}>
                        <CardHeader>
                          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Icon className="size-5" />
                          </div>
                          <CardTitle>
                            {t(`posters.promote.step${step}Title`)}
                          </CardTitle>
                          <CardDescription>
                            {t(`posters.promote.step${step}Description`, {
                              rate: formatCadCents(
                                promoterProgram.rateCents,
                                i18n.language,
                              ),
                            })}
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    );
                  })}
                </div>
              </Section>

              <Section
                title={t("posters.promote.coverageTitle", {
                  school: getSchoolDisplayName(school),
                })}
                description={t("posters.promote.coverageDescription")}
              >
                {coverage.isLoading ? (
                  <LoadingState label={t("posters.map.loading")} />
                ) : coverage.isError ? (
                  <Alert variant="warning">
                    <MapPin />
                    <AlertTitle>{t("posters.map.loadErrorTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("posters.map.loadErrorDescription")}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <QRScanMap markers={mapMarkers} height="440px" />
                )}
              </Section>
            </Stack>

            <div className="order-2 lg:sticky lg:top-20">
              <PromoterEnrollmentCard
                mode="recruitment"
                onEnrolled={() => router.push(ROUTES.POSTERS)}
              />
            </div>
          </div>
        </Stack>
      </Container>
    </main>
  );
}
