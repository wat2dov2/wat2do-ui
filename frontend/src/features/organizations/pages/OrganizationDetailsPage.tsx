"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Discord,
  ExternalLink,
  HelpCircle,
  Instagram,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { OrganizationEventsGrid } from "@/features/events/components/OrganizationEventsGrid";
import { OrganizationPositionsGrid } from "@/features/positions/components/OrganizationPositionsGrid";
import { ClaimOrganizationModal } from "@/features/organizations/components/ClaimOrganizationModal";
import { OrganizationCategoryBadges } from "@/features/organizations/components/OrganizationCategoryBadges";
import { OrganizationMembershipActions } from "@/features/organizations/components/OrganizationMembershipActions";
import { getOrganizationById } from "@/features/organizations/api/organizations.api";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { queryKeys } from "@/shared/lib/queryKeys";
import { sanitizeHref } from "@/shared/utils/url";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event, Organization, Position } from "@/shared/types";

interface OrganizationDetailsPageProps {
  organizationId: number;
  initialOrganization: Organization;
  initialEvents: Event[];
  initialPositions: Position[];
  schoolName: string;
}

interface OrganizationDetailsContentProps {
  organization: Organization;
  initialEvents: Event[];
  initialPositions: Position[];
  schoolName: string;
}

// Layout only: how the icon sits beside the label. The link's own appearance -
// colour, underline on hover - belongs to the Link primitive, not to this page.
const ORGANIZATION_LINK_CLASS = "flex items-center gap-2 text-sm";

function OrganizationDetailsContent({
  organization,
  initialEvents,
  initialPositions,
  schoolName,
}: OrganizationDetailsContentProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const [showClaimModal, setShowClaimModal] = useState(false);
  const toggleSave = useSavedOrganizationsStore(
    (state) => state.toggleSaveOrganization,
  );
  const savedOrganizationIds = useSavedOrganizationsStore(
    (state) => state.savedOrganizationIds,
  );
  const isSaved = savedOrganizationIds.includes(organization.id);
  const isUnowned = !organization.created_by;
  const organizationPageHref = sanitizeHref(organization.organization_page);
  const discordHref = sanitizeHref(organization.discord ?? "");

  return (
    <>
      <Container size="lg">
        <Stack gap={6}>
          <PageHeader
            back={{
              href: ROUTES.ORGANIZATIONS,
              label: t("organizations.allOrganizations"),
            }}
            title={organization.organization_name}
            description={schoolName}
            actionsPlacement="heading"
            actions={
              <Stack
                direction="horizontal"
                gap={2}
                align="center"
                wrap
                justify="end"
              >
                {!isAuthenticated ? (
                  <OrganizationMembershipActions organization={organization} />
                ) : null}
                {isAuthenticated ? (
                  <Button
                    type="button"
                    variant="secondary"
                    selected={isSaved}
                    onClick={() => toggleSave(organization.id)}
                  >
                    <Bookmark
                      className={isSaved ? "size-4 fill-current" : "size-4"}
                    />
                    {isSaved
                      ? t("organizations.saved")
                      : t("organizations.save")}
                  </Button>
                ) : null}
                {isAuthenticated && isUnowned ? (
                  <Button type="button" onClick={() => setShowClaimModal(true)}>
                    {t("organizations.claimOrganization")}
                  </Button>
                ) : null}
              </Stack>
            }
          />

          <Stack gap={3}>
            {isAuthenticated ? (
              <OrganizationMembershipActions organization={organization} />
            ) : null}

            <OrganizationCategoryBadges
              categories={organization.categories}
              badgeClassName="text-xs px-2.5"
            />

            <Stack direction="horizontal" gap={4} align="center" wrap>
              {organizationPageHref ? (
                <Link
                  href={organizationPageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <ExternalLink className="size-4 text-muted-foreground" />
                  <span className="truncate">
                    {organization.organization_page}
                  </span>
                </Link>
              ) : null}
              {organization.ig ? (
                <Link
                  href={`https://instagram.com/${organization.ig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <Instagram className="size-4 text-muted-foreground" />
                  <span>@{organization.ig}</span>
                </Link>
              ) : null}
              {discordHref ? (
                <Link
                  href={discordHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <Discord className="size-4 text-muted-foreground" />
                  <span>{t("organizationPanel.joinDiscord")}</span>
                </Link>
              ) : null}
            </Stack>

            {organization.status !== "approved" ? (
              <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
                <HelpCircle className="size-4 shrink-0" />
                <span>
                  {organization.status === "rejected"
                    ? t("organizations.reviewRejected")
                    : t("organizations.awaitingReview")}
                </span>
              </div>
            ) : null}
          </Stack>

          <Separator />

          <Tabs defaultValue="events">
            <TabsList aria-label={t("organizations.activityTabsLabel")}>
              <TabsTrigger value="events">{t("navigation.events")}</TabsTrigger>
              <TabsTrigger value="positions">
                {t("navigation.positions")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="events" className="mt-6">
              <OrganizationEventsGrid
                organizationId={organization.id}
                school={organization.school}
                initialEvents={initialEvents}
              />
            </TabsContent>
            <TabsContent value="positions" className="mt-6">
              <OrganizationPositionsGrid
                organizationId={organization.id}
                school={organization.school}
                initialPositions={initialPositions}
              />
            </TabsContent>
          </Tabs>
        </Stack>
      </Container>

      <ClaimOrganizationModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        organization={organization}
      />
    </>
  );
}

export function OrganizationDetailsPage({
  organizationId,
  initialOrganization,
  initialEvents,
  initialPositions,
  schoolName,
}: OrganizationDetailsPageProps) {
  const { t } = useTranslation();
  const {
    data: organization,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.organizations.detail(organizationId),
    queryFn: () => getOrganizationById(organizationId),
    enabled: Number.isInteger(organizationId) && organizationId > 0,
    initialData: initialOrganization,
  });

  if (isPending && !isError) {
    return <LoadingPage className="min-h-[60dvh]" />;
  }

  if (isError || !organization) {
    return (
      <Container size="sm" className="text-center">
        <p className="text-sm text-muted-foreground">
          {t("organizations.loadFailed")}
        </p>
      </Container>
    );
  }

  return (
    <OrganizationDetailsContent
      organization={organization}
      initialEvents={initialEvents}
      initialPositions={initialPositions}
      schoolName={schoolName}
    />
  );
}
