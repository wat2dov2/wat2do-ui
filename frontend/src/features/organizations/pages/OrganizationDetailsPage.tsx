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
import { Separator } from "@/shared/ui/separator";
import { useAuthState } from "@/features/auth";
import { OrganizationEventsGrid } from "@/features/events";
import { ClaimOrganizationModal } from "@/features/organizations/components/ClaimOrganizationModal";
import { OrganizationCategoryBadges } from "@/features/organizations/components/OrganizationCategoryBadges";
import { OrganizationLogo } from "@/features/organizations/components/OrganizationLogo";
import { OrganizationMembershipActions } from "@/features/organizations/components/OrganizationMembershipActions";
import { getOrganizationById } from "@/features/organizations/api/organizations.api";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { ROUTES } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { queryKeys } from "@/shared/lib/queryKeys";
import { sanitizeHref } from "@/shared/utils/url";
import type { Organization } from "@/shared/types";

interface OrganizationDetailsPageProps {
  organizationId: number;
}

interface OrganizationDetailsContentProps {
  organization: Organization;
}

const ORGANIZATION_LINK_CLASS =
  "flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary";

function OrganizationDetailsContent({
  organization,
}: OrganizationDetailsContentProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const { getSchoolName } = useSchoolDirectory();
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
            description={getSchoolName(organization.school)}
            actions={
              <Stack
                direction="horizontal"
                gap={2}
                align="center"
                wrap
                justify="end"
              >
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

          <Stack gap={4}>
            <OrganizationLogo organization={organization} />

            <OrganizationMembershipActions organization={organization} />

            <OrganizationCategoryBadges
              categories={organization.categories}
              badgeClassName="text-xs px-2.5"
            />

            <Stack direction="horizontal" gap={4} align="center" wrap>
              {organizationPageHref ? (
                <a
                  href={organizationPageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <ExternalLink className="size-4 text-muted-foreground" />
                  <span className="truncate">
                    {organization.organization_page}
                  </span>
                </a>
              ) : null}
              {organization.ig ? (
                <a
                  href={`https://instagram.com/${organization.ig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <Instagram className="size-4 text-muted-foreground" />
                  <span>@{organization.ig}</span>
                </a>
              ) : null}
              {discordHref ? (
                <a
                  href={discordHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ORGANIZATION_LINK_CLASS}
                >
                  <Discord className="size-4 text-muted-foreground" />
                  <span>{t("organizationPanel.joinDiscord")}</span>
                </a>
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

          <Section title={t("navigation.events")}>
            <OrganizationEventsGrid
              organizationName={organization.organization_name}
              school={organization.school}
            />
          </Section>
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
}: OrganizationDetailsPageProps) {
  const { t } = useTranslation();
  const { data: organization, isPending, isError } = useQuery({
    queryKey: queryKeys.organizations.detail(organizationId),
    queryFn: () => getOrganizationById(organizationId),
    enabled: Number.isInteger(organizationId) && organizationId > 0,
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

  return <OrganizationDetailsContent organization={organization} />;
}
