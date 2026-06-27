import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Instagram,
  Loader2,
  MessageCircle,
  Bookmark,
  Shield,
  UserPlus,
  X,
} from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
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
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { ClaimOrganizationModal } from "@/features/organizations/components/ClaimOrganizationModal";
import { JoinOrganizationModal } from "@/features/organizations/components/JoinOrganizationModal";

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

  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const toggleSave = useSavedOrganizationsStore((s) => s.toggleSaveOrganization);
  const savedOrganizationIds = useSavedOrganizationsStore((s) => s.savedOrganizationIds);
  const isSaved = organization ? savedOrganizationIds.includes(organization.id) : false;
  const isUnowned = organization ? (organization.created_by === null || !organization.created_by) : false;

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
        description: t("integrations.errors.connectFailed", { platform: organization.organization_name }),
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
        <Button onMouseDown={handleSignInRedirect} className="w-full font-medium">
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

    if (isUnowned) {
      return (
        <Button
          onMouseDown={() => setShowClaimModal(true)}
          className="w-full font-medium"
        >
          <Shield className="size-4 mr-2" />
          {t("organizations.claimOrganization")}
        </Button>
      );
    }

    if (!membership) {
      return (
        <Button onMouseDown={handleJoin} disabled={actionLoading} className="w-full font-medium">
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
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-medium"
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
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-medium"
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
            <AlertCircle className="size-4 shrink-0" />
            <span>{t("organizationPanel.requestDeclined")}</span>
          </div>
          <Button onMouseDown={handleJoin} disabled={actionLoading} className="w-full font-medium">
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("organizationPanel.reapply")}
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="overflow-hidden p-0">
        <div className="max-h-[96dvh] overflow-y-auto p-4">
          <DrawerClose asChild>
            <button
              type="button"
              className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </button>
          </DrawerClose>
          <DrawerHeader className="p-0 pr-11 text-left">
            <div className="space-y-3">
              <div className="space-y-1">
                <DrawerTitle className="text-xl font-bold text-foreground leading-tight">
                  {organization.organization_name}
                </DrawerTitle>
                <DrawerDescription className="text-sm text-muted-foreground">
                  {organization.organization_type}
                </DrawerDescription>
              </div>
              <OrganizationCategoryBadges
                categories={organization.categories}
                badgeClassName="text-xs px-2.5"
              />
            </div>
          </DrawerHeader>

          {/* Organization Details Body */}
          <div className="mt-5 space-y-5">
            {/* Social Links */}
            <div className="p-4 bg-secondary/30 border border-border rounded-xl space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("organizationPanel.linksAndSocials")}
              </h4>
              <div className="grid grid-cols-1 gap-2">
                {organization.organization_page && (
                  <a
                    href={sanitizeHref(organization.organization_page)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                  >
                    <ExternalLink className="size-4 text-muted-foreground" />
                    <span className="truncate">{organization.organization_page}</span>
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
            <div className="pt-5 border-t border-border flex flex-col gap-3">
              <div className="flex gap-3">
                {isAuthenticated && (
                  <Button
                    type="button"
                    variant={isSaved ? "secondary" : "outline"}
                    size="icon"
                    onMouseDown={() => toggleSave(organization.id)}
                    className={`border-border/80 shrink-0 ${
                      isSaved ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15" : ""
                    }`}
                    title={isSaved ? t("organizations.saved") : t("organizations.save")}
                  >
                    <Bookmark className={`size-4 ${isSaved ? "fill-current" : ""}`} />
                  </Button>
                )}
                <div className="flex-1">
                  {renderMembershipSection()}
                </div>
              </div>

              {isAuthenticated && !isUnowned && (
                <Button
                  variant="ghost"
                  onMouseDown={() => setShowJoinModal(true)}
                  className="w-full text-xs text-muted-foreground hover:text-primary font-medium h-8"
                >
                  <UserPlus className="size-3.5 mr-1" />
                  {t("organizations.applyToJoin")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DrawerContent>

      {showClaimModal && (
        <ClaimOrganizationModal
          isOpen={showClaimModal}
          onClose={() => setShowClaimModal(false)}
          organization={organization}
        />
      )}

      {showJoinModal && (
        <JoinOrganizationModal
          isOpen={showJoinModal}
          onClose={() => setShowJoinModal(false)}
          organization={organization}
        />
      )}
    </Drawer>
  );
}
