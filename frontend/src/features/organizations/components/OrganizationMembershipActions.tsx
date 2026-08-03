import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  UserPlus,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/hooks/use-toast";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { JoinOrganizationModal } from "@/features/organizations/components/JoinOrganizationModal";
import {
  getMyMembershipStatus,
  requestToJoinOrganization,
  leaveOrganizationOrCancelRequest,
  type OrganizationMembership,
} from "@/features/organization-panel/api/memberships.api";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import type { Organization } from "@/shared/types";

interface OrganizationMembershipActionsProps {
  organization: Organization;
}

interface MembershipStatusNoticeProps {
  tone: "warning" | "success" | "destructive";
  icon: React.ReactNode;
  children: React.ReactNode;
}

const noticeToneClasses = {
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
} as const;

function MembershipStatusNotice({ tone, icon, children }: MembershipStatusNoticeProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${noticeToneClasses[tone]}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

/**
 * Join / leave actions for an organization's management team.
 *
 * Renders nothing for an unclaimed organization - claiming it is the only
 * meaningful action there, and that button lives in the page header.
 */
export function OrganizationMembershipActions({
  organization,
}: OrganizationMembershipActionsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthState();
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [loadingMembership, setLoadingMembership] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const isUnowned = !organization.created_by;

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
        <Button onClick={() => router.push(ROUTES.LOGIN)}>
          {t("organizationPanel.signInToJoin")}
        </Button>
      );
    }

    if (isUnowned) {
      return null;
    }

    if (loadingMembership) {
      return (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>{t("organizationPanel.loadingMembership")}</span>
        </div>
      );
    }

    if (!membership) {
      return (
        <Button onClick={handleJoin} disabled={actionLoading}>
          {actionLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("organizationPanel.requestToJoin")}
        </Button>
      );
    }

    if (membership.status === "pending") {
      return (
        <>
          <MembershipStatusNotice
            tone="warning"
            icon={<HelpCircle className="size-4 shrink-0" />}
          >
            {t("organizationPanel.requestPending")}
          </MembershipStatusNotice>
          <Button
            variant="secondary"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="border-destructive/30 text-destructive"
          >
            {actionLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("organizationPanel.cancelRequest")}
          </Button>
        </>
      );
    }

    if (membership.status === "approved") {
      return (
        <>
          <MembershipStatusNotice
            tone="success"
            icon={<CheckCircle2 className="size-4 shrink-0" />}
          >
            {t("organizationPanel.memberBadge")}
          </MembershipStatusNotice>
          <Button
            variant="secondary"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="border-destructive/30 text-destructive"
          >
            {actionLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("organizationPanel.leaveClub")}
          </Button>
        </>
      );
    }

    return (
      <>
        <MembershipStatusNotice
          tone="destructive"
          icon={<AlertCircle className="size-4 shrink-0" />}
        >
          {t("organizationPanel.requestDeclined")}
        </MembershipStatusNotice>
        <Button onClick={handleJoin} disabled={actionLoading}>
          {actionLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("organizationPanel.reapply")}
        </Button>
      </>
    );
  };

  const membershipAction = renderMembershipAction();
  const canApplyToJoin = isAuthenticated && !isUnowned;

  if (!membershipAction && !canApplyToJoin) {
    return null;
  }

  return (
    <>
      <Stack direction="horizontal" gap={2} align="center" wrap>
        {membershipAction}
        {canApplyToJoin ? (
          <Button
            variant="ghost"
            onClick={() => setShowJoinModal(true)}
            className="text-muted-foreground hover:text-primary"
          >
            <UserPlus className="size-4" />
            {t("organizations.applyToJoin")}
          </Button>
        ) : null}
      </Stack>

      <JoinOrganizationModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        organization={organization}
      />
    </>
  );
}
