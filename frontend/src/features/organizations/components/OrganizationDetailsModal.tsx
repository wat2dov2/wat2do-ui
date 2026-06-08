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
import { Badge } from "@/shared/ui/badge";
import { toast } from "@/shared/hooks/use-toast";
import { useAuthState } from "@/features/auth";
import { ROUTES } from "@/shared/constants/routes";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";
import { getCategoryClasses } from "@/shared/utils/event";
import { sanitizeHref } from "@/shared/utils/url";
import type { Club } from "@/shared/types";
import {
  getMyMembershipStatus,
  requestToJoinClub,
  leaveClubOrCancelRequest,
  type ClubMembership,
} from "@/features/organization-panel/api/memberships.api";

interface OrganizationDetailsModalProps {
  club: Club | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (clubId: number, status: "pending" | "approved" | "rejected" | null) => void;
}

export function OrganizationDetailsModal({ club, isOpen, onClose, onStatusChange }: OrganizationDetailsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthState();

  const [membership, setMembership] = useState<ClubMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch membership status
  useEffect(() => {
    if (!club || !isOpen || !isAuthenticated) {
      setMembership(null);
      return;
    }

    setLoading(true);
    getMyMembershipStatus(club.id)
      .then((status) => {
        setMembership(status);
      })
      .catch((err) => {
        console.error("Failed to load membership status:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [club, isOpen, isAuthenticated]);

  if (!club) return null;

  const handleJoin = async () => {
    setActionLoading(true);
    try {
      const newMembership = await requestToJoinClub(club.id);
      setMembership(newMembership);
      toast({ description: t("clubPanel.joinSuccess"), variant: "success" });
      onStatusChange?.(club.id, "pending");
    } catch (err) {
      console.error("Failed to join club:", err);
      toast({
        description: t("integrations.errors.connectFailed", { platform: club.club_name }),
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
      await leaveClubOrCancelRequest(club.id);
      setMembership(null);
      toast({
        description: isPending ? t("clubPanel.cancelSuccess") : t("clubPanel.leaveSuccess"),
        variant: "success",
      });
      onStatusChange?.(club.id, null);
    } catch (err) {
      console.error("Failed to leave/cancel request:", err);
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
        <Button onClick={handleSignInRedirect} className="w-full font-semibold">
          {t("clubPanel.signInToJoin")}
        </Button>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span>{t("clubPanel.loadingMembership")}</span>
        </div>
      );
    }

    if (!membership) {
      return (
        <Button onClick={handleJoin} disabled={actionLoading} className="w-full font-semibold">
          {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
          {t("clubPanel.requestToJoin")}
        </Button>
      );
    }

    if (membership.status === "pending") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-sm">
            <HelpCircle className="size-4 shrink-0" />
            <span>{t("clubPanel.requestPending")}</span>
          </div>
          <Button
            variant="outline"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-semibold"
          >
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("clubPanel.cancelRequest")}
          </Button>
        </div>
      );
    }

    if (membership.status === "approved") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-500 rounded-lg text-sm">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{t("clubPanel.memberBadge")}</span>
          </div>
          <Button
            variant="outline"
            onClick={handleLeaveOrCancel}
            disabled={actionLoading}
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-semibold"
          >
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("clubPanel.leaveClub")}
          </Button>
        </div>
      );
    }

    if (membership.status === "rejected") {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
            <XCircle className="size-4 shrink-0" />
            <span>{t("clubPanel.requestDeclined")}</span>
          </div>
          <Button onClick={handleJoin} disabled={actionLoading} className="w-full font-semibold">
            {actionLoading && <Loader2 className="size-4 animate-spin mr-2" />}
            {t("clubPanel.reapply")}
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
              {club.logo_url ? (
                <img
                  src={club.logo_url}
                  alt={club.club_name}
                  className="size-full object-cover rounded-2xl"
                />
              ) : (
                <Users className="size-8 text-primary" />
              )}
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-xl font-bold text-foreground leading-tight">
                {club.club_name}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {club.school}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Club Details Body */}
        <div className="space-y-5">
          {/* Metadata Section */}
          <div className="space-y-3">
            {/* Club Type */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Tag className="size-4 text-muted-foreground" />
              <span>{club.club_type}</span>
            </div>

            {/* Categories */}
            <div className="flex flex-wrap gap-1.5">
              {club.categories.map((category) => {
                const colors = getCategoryClasses(category);
                return (
                  <Badge
                    key={category}
                    variant="outline"
                    className={`${colors.bg} ${colors.text} text-xs px-2.5 py-0.5 rounded-full font-medium border-0`}
                  >
                    {getClubCategoryTranslation(category, t)}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Social Links */}
          <div className="p-4 bg-secondary/30 border border-border rounded-xl space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("clubPanel.linksAndSocials")}
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {club.club_page && (
                <a
                  href={sanitizeHref(club.club_page)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="truncate">{club.club_page}</span>
                </a>
              )}
              {club.ig && (
                <a
                  href={`https://instagram.com/${club.ig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <Instagram className="size-4 text-muted-foreground" />
                  <span>@{club.ig}</span>
                </a>
              )}
              {club.discord && sanitizeHref(club.discord) && (
                <a
                  href={sanitizeHref(club.discord)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <MessageCircle className="size-4 text-muted-foreground" />
                  <span>{t("clubPanel.joinDiscord")}</span>
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
