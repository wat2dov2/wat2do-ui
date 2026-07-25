import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Discord,
  ExternalLink,
  HelpCircle,
  Instagram,
  Loader2,
  UserPlus,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { toast } from "@/shared/hooks/use-toast";
import { useAuthState } from "@/features/auth";
import { ClaimOrganizationModal } from "@/features/organizations/components/ClaimOrganizationModal";
import { JoinOrganizationModal } from "@/features/organizations/components/JoinOrganizationModal";
import { OrganizationCategoryBadges } from "@/features/organizations/components/OrganizationCategoryBadges";
import { getOrganizationById } from "@/features/organizations/api/organizations.api";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import {
  getMyMembershipStatus,
  requestToJoinOrganization,
  leaveOrganizationOrCancelRequest,
  type OrganizationMembership,
} from "@/features/organization-panel/api/memberships.api";
import { ROUTES } from "@/shared/constants/routes";
import { getSchoolDisplayName } from "@/shared/constants/schools";
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

function OrganizationDetailsContent({
  organization,
}: OrganizationDetailsContentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthState();
  const [membership, setMembership] =
    useState<OrganizationMembership | null>(null);
  const [loadingMembership, setLoadingMembership] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
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

  useEffect(() => {
    if (!isAuthenticated) {
      setMembership(null);
      return;
    }

    let cancelled = false;
    setLoadingMembership(true);
    getMyMembershipStatus(organization.id)
      .then((status) => {
        if (!cancelled) setMembership(status);
      })
      .catch((error) => {
        console.error("Failed to load membership status:", error);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembership(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, organization.id]);

  const handleJoin = async () => {
    setActionLoading(true);
    try {
      const newMembership = await requestToJoinOrganization(organization.id);
      setMembership(newMembership);
      toast({
        description: t("organizationPanel.joinSuccess"),
        variant: "success",
      });
    } catch (error) {
      console.error("Failed to join organization:", error);
      toast({
        description: t("integrations.errors.connectFailed", {
          platform: organization.organization_name,
        }),
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeaveOrCancel = async () => {
    const isPending = membership?.status === "pending";
    setActionLoading(true);
    try {
      await leaveOrganizationOrCancelRequest(organization.id);
      setMembership(null);
      toast({
        description: isPending
          ? t("organizationPanel.cancelSuccess")
          : t("organizationPanel.leaveSuccess"),
        variant: "success",
      });
    } catch (error) {
      console.error("Failed to leave or cancel organization request:", error);
      toast({
        description: t("organizations.savedClubs.unsaveFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const renderMembershipAction = () => {
    if (!isAuthenticated) {
      return (
        <Button onClick={() => router.push(ROUTES.LOGIN)} className="w-full">
          {t("organizationPanel.signInToJoin")}
        </Button>
      );
    }

    if (loadingMembership) {
      return (
        <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          <span>{t("organizationPanel.loadingMembership")}</span>
        </div>
      );
    }

    if (isUnowned) {
      return (
        <Button onClick={() => setShowClaimModal(true)} className="w-full">
          {t("organizations.claimOrganization")}
        </Button>
      );
    }

    if (!membership) {
      return (
        <Button
          onClick={handleJoin}
          disabled={actionLoading}
          className="w-full"
        >
          {actionLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("organizationPanel.requestToJoin")}
        </Button>
      );
    }

    if (membership.status === "pending") {
      return (
        <Stack gap={3}>
          <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
            <HelpCircle className="size-4 shrink-0" />
            <span>{t("organizationPanel.requestPending")}</span>
          </div>
          <Button
            variant="secondary"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive"
          >
            {actionLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t("organizationPanel.cancelRequest")}
          </Button>
        </Stack>
      );
    }

    if (membership.status === "approved") {
      return (
        <Stack gap={3}>
          <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{t("organizationPanel.memberBadge")}</span>
          </div>
          <Button
            variant="secondary"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive"
          >
            {actionLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t("organizationPanel.leaveClub")}
          </Button>
        </Stack>
      );
    }

    return (
      <Stack gap={3}>
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{t("organizationPanel.requestDeclined")}</span>
        </div>
        <Button onClick={handleJoin} disabled={actionLoading} className="w-full">
          {actionLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("organizationPanel.reapply")}
        </Button>
      </Stack>
    );
  };

  return (
    <>
      <Container size="sm" className="py-4 sm:py-6">
        <Stack gap={6}>
          <Button asChild variant="secondary" size="sm" className="self-start">
            <Link href={ROUTES.ORGANIZATIONS}>
              <ArrowLeft className="size-4" />
              {t("organizations.backToAllOrganizations")}
            </Link>
          </Button>

          <PageHeader
            title={organization.organization_name}
            description={getSchoolDisplayName(organization.school)}
          />

          <OrganizationCategoryBadges
            categories={organization.categories}
            badgeClassName="text-xs px-2.5"
          />

          <Section
            variant="surface"
            title={t("organizationPanel.linksAndSocials")}
          >
            <Stack gap={2}>
              {organizationPageHref ? (
                <a
                  href={organizationPageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
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
                  className="flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
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
                  className="flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
                >
                  <Discord className="size-4 text-muted-foreground" />
                  <span>{t("organizationPanel.joinDiscord")}</span>
                </a>
              ) : null}
            </Stack>
          </Section>

          {organization.status !== "approved" ? (
            <Section variant="surface">
              <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
                <HelpCircle className="size-4 shrink-0" />
                <span>
                  {organization.status === "rejected"
                    ? t("organizations.reviewRejected")
                    : t("organizations.awaitingReview")}
                </span>
              </div>
            </Section>
          ) : null}

          <Section variant="surface">
            <Stack gap={3}>
              <div className="flex gap-3">
                {isAuthenticated ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    selected={isSaved}
                    onClick={() => toggleSave(organization.id)}
                    aria-label={
                      isSaved
                        ? t("organizations.saved")
                        : t("organizations.save")
                    }
                  >
                    <Bookmark
                      className={isSaved ? "size-4 fill-current" : "size-4"}
                    />
                  </Button>
                ) : null}
                <div className="flex-1">{renderMembershipAction()}</div>
              </div>

              {isAuthenticated && !isUnowned ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowJoinModal(true)}
                  className="w-full text-muted-foreground hover:text-primary"
                >
                  <UserPlus className="size-4" />
                  {t("organizations.applyToJoin")}
                </Button>
              ) : null}
            </Stack>
          </Section>
        </Stack>
      </Container>

      <ClaimOrganizationModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        organization={organization}
      />
      <JoinOrganizationModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
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
      <Container size="sm" className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          {t("organizations.loadFailed")}
        </p>
      </Container>
    );
  }

  return <OrganizationDetailsContent organization={organization} />;
}
