import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Users, Check, X, Loader2, UserMinus, ShieldAlert } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { useAuthState } from "@/features/auth";
import { toast } from "@/shared/hooks/use-toast";
import {
  listClubMemberships,
  updateClubMembership,
  removeClubMember,
  type ClubMembershipWithUser,
} from "@/features/club-panel/api/memberships.api";

export function ClubPanelMembersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clubId } = useAuthState();

  const [memberships, setMemberships] = useState<ClubMembershipWithUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // tracks user_id currently undergoing an action
  const [activeTab, setActiveTab] = useState<"members" | "requests">("members");

  const fetchRoster = useCallback(() => {
    if (!clubId) return;
    setLoading(true);
    listClubMemberships(clubId)
      .then((data) => {
        setMemberships(data);
      })
      .catch((err) => {
        console.error("Failed to load club members:", err);
        toast({ description: t("integrations.errors.loadIntegrationsFailed"), variant: "destructive" });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [clubId, t]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleApprove = async (userId: string) => {
    if (!clubId) return;
    setActionLoading(userId);
    try {
      await updateClubMembership(clubId, userId, { status: "approved" });
      toast({ description: t("clubPanel.requestApproved"), variant: "success" });
      fetchRoster();
    } catch (err) {
      console.error("Failed to approve membership:", err);
      toast({ description: t("events.savedEvents.saveFailed"), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (userId: string) => {
    if (!clubId) return;
    setActionLoading(userId);
    try {
      // Rejections transition status to 'rejected'
      await updateClubMembership(clubId, userId, { status: "rejected" });
      toast({ description: t("clubPanel.requestRejected"), variant: "success" });
      fetchRoster();
    } catch (err) {
      console.error("Failed to reject membership:", err);
      toast({ description: t("events.savedEvents.unsaveFailed"), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!clubId) return;
    setActionLoading(userId);
    try {
      await removeClubMember(clubId, userId);
      toast({ description: t("clubPanel.memberRemoved"), variant: "success" });
      fetchRoster();
    } catch (err) {
      console.error("Failed to remove member:", err);
      toast({ description: t("events.savedEvents.unsaveFailed"), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // Filter roster
  const activeMembers = memberships.filter((m) => m.status === "approved");
  const pendingRequests = memberships.filter((m) => m.status === "pending");

  // Render role tag
  const renderRoleTag = (role: string) => {
    switch (role) {
      case "owner":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-primary/20 text-primary">
            {t("clubPanel.roleOwner")}
          </span>
        );
      case "officer":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400">
            {t("clubPanel.roleOfficer")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground">
            {t("clubPanel.roleMember")}
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate(ROUTES.CLUB_PANEL)}
          className="shrink-0"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Users className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("clubPanel.members")}</h1>
          <p className="text-sm text-muted-foreground">{t("clubPanel.membersDesc")}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("members")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "members"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("clubPanel.activeMembers")} ({activeMembers.length})
        </button>
        <button
          onClick={() => setActiveTab("requests")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "requests"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("clubPanel.pendingRequests")} ({pendingRequests.length})
        </button>
      </div>

      {/* Roster View */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-primary mb-3" />
          <span className="text-muted-foreground text-sm">{t("clubPanel.loadingRoster")}</span>
        </div>
      ) : activeTab === "members" ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          {activeMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-secondary/35 border-b border-border">
                  <tr>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.name")}
                    </th>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.email")}
                    </th>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.role")}
                    </th>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.joined")}
                    </th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {activeMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-foreground">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold uppercase overflow-hidden shrink-0">
                            {member.user.avatar_url ? (
                              <img
                                src={member.user.avatar_url}
                                alt={member.user.full_name || ""}
                                className="size-full object-cover"
                              />
                            ) : (
                              (member.user.full_name || member.user.username || "?").charAt(0)
                            )}
                          </div>
                          <span>{member.user.full_name || member.user.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {member.user.email}
                      </td>
                      <td className="px-6 py-4 text-sm">{renderRoleTag(member.role)}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {new Date(member.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {member.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(member.user.id)}
                            disabled={actionLoading !== null}
                            className="text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            {actionLoading === member.user.id ? (
                              <Loader2 className="size-4 animate-spin mr-1" />
                            ) : (
                              <UserMinus className="size-4 mr-1" />
                            )}
                            {t("clubPanel.remove")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center">
              <Users className="size-12 text-muted-foreground/45 mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-1">
                {t("clubPanel.noMembersYet")}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t("clubPanel.noMembersDesc")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          {pendingRequests.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-secondary/35 border-b border-border">
                  <tr>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.name")}
                    </th>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.email")}
                    </th>
                    <th className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider">
                      {t("clubPanel.memberColumns.requested")}
                    </th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pendingRequests.map((request) => (
                    <tr key={request.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-foreground">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold uppercase overflow-hidden shrink-0">
                            {request.user.avatar_url ? (
                              <img
                                src={request.user.avatar_url}
                                alt={request.user.full_name || ""}
                                className="size-full object-cover"
                              />
                            ) : (
                              (request.user.full_name || request.user.username || "?").charAt(0)
                            )}
                          </div>
                          <span>{request.user.full_name || request.user.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {request.user.email}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {new Date(request.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleApprove(request.user.id)}
                            disabled={actionLoading !== null}
                            className="bg-green-500/10 border border-green-500/20 text-green-500 hover:bg-green-500/20 shrink-0 font-semibold"
                          >
                            {actionLoading === request.user.id ? (
                              <Loader2 className="size-4 animate-spin mr-1" />
                            ) : (
                              <Check className="size-4 mr-1" />
                            )}
                            {t("clubPanel.approve")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReject(request.user.id)}
                            disabled={actionLoading !== null}
                            className="text-destructive hover:bg-destructive/10 shrink-0 font-semibold"
                          >
                            {actionLoading === request.user.id ? (
                              <Loader2 className="size-4 animate-spin mr-1" />
                            ) : (
                              <X className="size-4 mr-1" />
                            )}
                            {t("clubPanel.reject")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center">
              <ShieldAlert className="size-12 text-muted-foreground/45 mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-1">
                {t("clubPanel.noRequestsYet")}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t("clubPanel.noRequestsDesc")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
