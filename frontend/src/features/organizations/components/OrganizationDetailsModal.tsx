import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Instagram,
  MessageCircle,
  Globe,
  Tag,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/hooks/use-toast";
import { useAuthState } from "@/features/auth";
import { ROUTES } from "@/shared/constants/routes";
import { sanitizeHref } from "@/shared/utils/url";
import type { Organization } from "@/shared/types";
import { OrganizationCategoryBadges } from "./OrganizationCategoryBadges";
import {
  getMyMembershipStatus,
  requestToJoinOrganization,
  leaveOrganizationOrCancelRequest,
  type OrganizationMembership,
} from "@/features/organization-panel/api/memberships.api";

interface OrganizationDetailsModalProps {
  organization: Organization | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (organizationId: number, status: "pending" | "approved" | "rejected" | null) => void;
}

export function OrganizationDetailsModal({ organization, isOpen, onClose, onStatusChange }: OrganizationDetailsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthState();

  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch membership status
  useEffect(() => {
    if (!organization || !isOpen || !isAuthenticated) {
      setMembership(null);
      return;
    }

    setLoading(true);
    getMyMembershipStatus(organization.id)
      .then((status) => {
        setMembership(status);
      })
      .catch((err) => {
        console.error("Failed to load membership status:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organization, isOpen, isAuthenticated]);

  if (!organization) return null;

  const handleJoin = async () => {
    setActionLoading(true);
    try {
      const newMembership = await requestToJoinOrganization(organization.id);
      setMembership(newMembership);
      toast({ description: t("organizationPanel.joinSuccess"), variant: "success" });
      onStatusChange?.(organization.id, "pending");
    } catch (err) {
      console.error("Failed to join organization:", err);
      toast({
        description: t("integrations.errors.connectFailed", { platform: organization.club_name }),
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
        description: isPending ? t("organizationPanel.cancelSuccess") : t("organizationPanel.leaveSuccess"),
        variant: "success",
      });
      onStatusChange?.(organization.id, null);
    } catch (err) {
      console.error("Failed to leave/cancel organization request:", err);
      toast({ description: t("events.savedEvents.unsaveFailed"), variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignInRedirect = () => {
    onClose();
    navigate(ROUTES.LOGIN);
  };

  // Compute membership UI states
  const renderMembershipSection = () => {
    if (!isAuthenticated) {
      return (
        <Button onMouseDown={handleSignInRedirect} className="w-full font-semibold">
          {t("organizationPanel.signInToJoin")}
        </Button>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span>{t("organizationPanel.loadingMembership")}</span>
        </div>
      );
    }

    if (!membership) {
      return (
        <Button onMouseDown={handleJoin} disabled={actionLoading} className="w-full font-semibold">
          {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
          {t("organizationPanel.requestToJoin")}
        </Button>
      );
    }

    if (membership.status === "pending") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-sm">
            <HelpCircle className="size-4 shrink-0" />
            <span>{t("organizationPanel.requestPending")}</span>
          </div>
          <Button
            variant="outline"
            onMouseDown={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-semibold"
          >
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("organizationPanel.cancelRequest")}
          </Button>
        </div>
      );
    }

    if (membership.status === "approved") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-500 rounded-lg text-sm">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{t("organizationPanel.memberBadge")}</span>
          </div>
          <Button
            variant="outline"
            onMouseDown={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-semibold"
          >
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("organizationPanel.leaveClub")}
          </Button>
        </div>
      );
    }

    if (membership.status === "rejected") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
            <XCircle className="size-4 shrink-0" />
            <span>{t("organizationPanel.requestDeclined")}</span>
          </div>
          <Button onMouseDown={handleJoin} disabled={actionLoading} className="w-full font-semibold">
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("organizationPanel.reapply")}
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px] overflow-hidden p-6 bg-card border-border rounded-2xl shadow-xl">
        <DialogHeader className="mb-4">
          <div className="flex items-start gap-4">
            <div className="size-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
              <Users className="size-8 text-primary" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-xl font-bold text-foreground leading-tight">
                {organization.club_name}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {organization.school}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Organization Details Body */}
        <div className="space-y-5">
          {/* Metadata Section */}
          <div className="space-y-3">
            {/* Organization Type */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Tag className="size-4 text-muted-foreground" />
              <span>{organization.club_type}</span>
            </div>

            {/* Categories */}
            <OrganizationCategoryBadges
              categories={organization.categories}
              badgeClassName="text-xs px-2.5"
            />
          </div>

          {/* Social Links */}
          <div className="p-4 bg-secondary/30 border border-border rounded-xl space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("organizationPanel.linksAndSocials")}
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {organization.club_page && (
                <a
                  href={sanitizeHref(organization.club_page)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="truncate">{organization.club_page}</span>
                </a>
              )}
              {organization.ig && (
                <a
                  href={`https://instagram.com/${organization.ig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <Instagram className="size-4 text-muted-foreground" />
                  <span>@{organization.ig}</span>
                </a>
              )}
              {organization.discord && sanitizeHref(organization.discord) && (
                <a
                  href={sanitizeHref(organization.discord)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <MessageCircle className="size-4 text-muted-foreground" />
                  <span>{t("organizationPanel.joinDiscord")}</span>
                </a>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-2 border-t border-border">{renderMembershipSection()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
