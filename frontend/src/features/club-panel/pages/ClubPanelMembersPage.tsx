import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Users,
  Check,
  X,
  Loader2,
  UserMinus,
  UserPlus,
  ShieldAlert,
  Search,
  MailOpen,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { useAuthState } from "@/features/auth";
import { toast } from "@/shared/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  listClubMemberships,
  updateClubMembership,
  removeClubMember as removeRosterMembership,
  type ClubMembershipWithUser,
} from "@/features/club-panel/api/memberships.api";
import {
  fetchClubMembers,
  addClubMember,
  removeClubMember as removeClubManager,
  fetchClubInvitations,
  revokeClubInvitation,
  type ClubMember,
  type ClubInvitation,
} from "../api/members.api";
import {
  fetchJoinRequests,
  resolveJoinRequest,
  type ClubJoinRequest,
} from "../api/joinRequests.api";

export function ClubPanelMembersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clubId } = useAuthState();

  // Navigation tabs
  const [mainTab, setMainTab] = useState<"roster" | "management">("roster");
  const [activeTab, setActiveTab] = useState<"members" | "requests">("members");

  // Roster state
  const [memberships, setMemberships] = useState<ClubMembershipWithUser[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Management state
  const [managers, setManagers] = useState<ClubMember[]>([]);
  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const [joinRequests, setJoinRequests] = useState<ClubJoinRequest[]>([]);
  const [managementLoading, setManagementLoading] = useState(false);

  // Form & Search inputs
  const [emailInput, setEmailInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRoster = useCallback(() => {
    if (!clubId) return;
    setRosterLoading(true);
    listClubMemberships(clubId)
      .then((data) => {
        setMemberships(data);
      })
      .catch((err) => {
        console.error("Failed to load club roster:", err);
        toast({
          description: t("integrations.errors.loadIntegrationsFailed"),
          variant: "destructive",
        });
      })
      .finally(() => {
        setRosterLoading(false);
      });
  }, [clubId, t]);

  const fetchManagement = useCallback(() => {
    if (!clubId) return;
    setManagementLoading(true);
    Promise.all([
      fetchClubMembers(clubId),
      fetchClubInvitations(clubId),
      fetchJoinRequests(clubId),
    ])
      .then(([membersData, invitesData, requestsData]) => {
        setManagers(membersData);
        setInvitations(invitesData);
        setJoinRequests(requestsData);
      })
      .catch((err) => {
        console.error("Failed to load management team:", err);
        toast({
          description: t("clubPanel.loadingClubMembers") || "Failed to load management details.",
          variant: "destructive",
        });
      })
      .finally(() => {
        setManagementLoading(false);
      });
  }, [clubId, t]);

  useEffect(() => {
    if (clubId) {
      fetchRoster();
      fetchManagement();
    }
  }, [clubId, fetchRoster, fetchManagement]);

  // Roster Actions
  const handleApproveMembership = async (userId: string) => {
    if (!clubId) return;
    setActionLoading(userId);
    try {
      await updateClubMembership(clubId, userId, { status: "approved" });
      toast({
        description: t("clubPanel.requestApproved") || "Membership request approved.",
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to approve membership:", err);
      toast({
        description: t("events.savedEvents.saveFailed") || "Failed to approve membership request.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectMembership = async (userId: string) => {
    if (!clubId) return;
    setActionLoading(userId);
    try {
      await updateClubMembership(clubId, userId, { status: "rejected" });
      toast({
        description: t("clubPanel.requestRejected") || "Membership request rejected.",
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to reject membership:", err);
      toast({
        description: t("events.savedEvents.unsaveFailed") || "Failed to reject membership request.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveMembership = async (userId: string) => {
    if (!clubId) return;
    if (!confirm(t("clubPanel.removeMemberConfirm") || "Are you sure you want to remove this member?")) {
      return;
    }
    setActionLoading(userId);
    try {
      await removeRosterMembership(clubId, userId);
      toast({
        description: t("clubPanel.memberRemoved") || "Member removed from roster.",
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to remove member:", err);
      toast({
        description: t("events.savedEvents.unsaveFailed") || "Failed to remove member.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Management Actions
  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId || !emailInput.trim()) return;

    setSubmitting(true);
    try {
      const result = await addClubMember(clubId, emailInput.trim().toLowerCase());
      if (result && "status" in result && result.status === "pending") {
        toast({
          title: "Success",
          description: `Invitation sent to ${emailInput.trim().toLowerCase()}!`,
          variant: "success",
        });
      } else {
        toast({
          title: "Success",
          description: t("clubPanel.addSuccess") || "Member added successfully!",
          variant: "success",
        });
      }
      setEmailInput("");
      fetchManagement();
    } catch (err) {
      console.error("Failed to add manager:", err);
      toast({
        title: "Error",
        description: "Failed to add manager or send invitation.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!clubId) return;
    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) {
      return;
    }
    setActionLoading(invitationId);
    try {
      await revokeClubInvitation(clubId, invitationId);
      toast({
        title: "Success",
        description: "Invitation revoked successfully!",
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
      toast({
        title: "Error",
        description: "Failed to revoke invitation.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolveJoinRequest = async (requestId: string, status: "approved" | "rejected") => {
    if (!clubId) return;
    setActionLoading(requestId);
    try {
      await resolveJoinRequest(clubId, requestId, status);
      toast({
        title: "Success",
        description: `Join request ${status} successfully!`,
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: `Failed to ${status} join request.`,
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveManager = async (userId: string, email: string) => {
    if (!clubId) return;

    const confirmMsg = t("clubPanel.removeMemberConfirm") || "Are you sure you want to remove this member? They will lose manager access to this club.";
    if (!confirm(`${confirmMsg}\n\nEmail: ${email}`)) {
      return;
    }

    setActionLoading(userId);
    try {
      await removeClubManager(clubId, userId);
      toast({
        title: "Success",
        description: t("clubPanel.removeSuccess") || "Member removed successfully!",
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error(err);
      const errorObj = err as { response?: { data?: { detail?: string } }; message?: string };
      const detail = errorObj?.response?.data?.detail || errorObj?.message || "Failed to remove member.";
      toast({
        title: "Error",
        description: detail,
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Helper functions for initials
  const getInitials = (fullName: string | null, email: string) => {
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      if (parts.length === 1 && parts[0]) {
        return parts[0][0].toUpperCase();
      }
    }
    return email ? email[0].toUpperCase() : "?";
  };

  // Filter lists
  const activeMembers = memberships.filter((m) => m.status === "approved");
  const pendingRequests = memberships.filter((m) => m.status === "pending");

  const filteredManagers = managers.filter((member) => {
    const q = searchQuery.toLowerCase();
    const name = (member.full_name || "").toLowerCase();
    const email = (member.email || "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  // Render role tag
  const renderRoleTag = (role: string) => {
    const normalizedRole = role.toLowerCase();
    switch (normalizedRole) {
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

  if (!clubId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShieldAlert className="size-12 text-muted-foreground/45 mb-4" />
        <h3 className="font-semibold text-foreground mb-1">
          {t("clubPanel.noActiveClubSelected")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("clubPanel.noActiveClubSelectedDesc")}
        </p>
      </div>
    );
  }

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

      {/* Main Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setMainTab("roster")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            mainTab === "roster"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("clubPanel.rosterTab")}
        </button>
        <button
          onClick={() => setMainTab("management")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            mainTab === "management"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("clubPanel.managementTab")}
        </button>
      </div>

      {/* Tab Contents */}
      {mainTab === "roster" ? (
        <div className="space-y-5">
          {/* Sub Tabs */}
          <div className="flex border-b border-border/60">
            <button
              onClick={() => setActiveTab("members")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "members"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("clubPanel.activeMembers")} ({activeMembers.length})
            </button>
            <button
              onClick={() => setActiveTab("requests")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "requests"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("clubPanel.pendingRequests")} ({pendingRequests.length})
            </button>
          </div>

          {/* Roster lists */}
          {rosterLoading ? (
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
                                onClick={() => handleRemoveMembership(member.user.id)}
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
                                onClick={() => handleApproveMembership(request.user.id)}
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
                                onClick={() => handleRejectMembership(request.user.id)}
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
      ) : (
        <div className="space-y-6">
          {/* Invite Manager Card */}
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <UserPlus className="size-5 text-primary" />
                {t("clubPanel.inviteOrAddManager")}
              </CardTitle>
              <CardDescription>
                {t("clubPanel.inviteOrAddManagerDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddManager} className="flex gap-3 max-w-md">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder={t("clubPanel.enterEmail") || "Enter email address"}
                  required
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
                />
                <Button type="submit" disabled={submitting || !emailInput.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      {t("clubPanel.sending")}
                    </>
                  ) : (
                    t("clubPanel.inviteAddManagerButton")
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Managers List Card */}
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="size-5 text-primary" />
                  {t("clubPanel.currentlyAuthorizedManagers")}
                </CardTitle>
                <CardDescription>
                  {t("clubPanel.membersDesc")}
                </CardDescription>
              </div>
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("clubPanel.searchManagersPlaceholder") || "Search managers by name or email..."}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {managementLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-primary mb-3" />
                  <span className="text-muted-foreground text-sm">
                    {t("clubPanel.loadingClubMembers") || "Loading club members..."}
                  </span>
                </div>
              ) : filteredManagers.length > 0 ? (
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
                      {filteredManagers.map((member) => (
                        <tr key={member.user_id} className="hover:bg-secondary/10 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-foreground">
                            <div className="flex items-center gap-3">
                              <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold uppercase overflow-hidden shrink-0">
                                {member.avatar_url ? (
                                  <img
                                    src={member.avatar_url}
                                    alt={member.full_name || ""}
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  getInitials(member.full_name, member.email)
                                )}
                              </div>
                              <span>{member.full_name || member.email.split("@")[0]}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            {member.email}
                          </td>
                          <td className="px-6 py-4 text-sm">{renderRoleTag(member.role)}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            {new Date(member.joined_at).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {member.role.toLowerCase() !== "owner" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveManager(member.user_id, member.email)}
                                disabled={actionLoading !== null}
                                className="text-destructive hover:bg-destructive/10 shrink-0"
                              >
                                {actionLoading === member.user_id ? (
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
            </CardContent>
          </Card>

          {/* Pending Join Requests list */}
          {joinRequests.length > 0 && (
            <Card className="bg-card border border-border shadow-sm mt-6">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <UserPlus className="size-5 text-primary" />
                  {t("clubPanel.pendingJoinRequests", { count: joinRequests.length })}
                </CardTitle>
                <CardDescription>
                  {t("clubPanel.pendingJoinRequestsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-secondary/35 border-b border-border">
                      <tr>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.studentNameEmail") || "Student Name / Email"}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.pitch") || "Pitch"}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.invitedAt") || "Submitted"}
                        </th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {joinRequests.map((req) => (
                        <tr key={req.id} className="transition-colors hover:bg-secondary/10">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-semibold text-foreground">
                              {req.users?.full_name || "Student"}
                            </div>
                            <div className="text-xs text-muted-foreground font-medium">
                              {req.users?.email}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-foreground max-w-xs break-words italic">
                            "{req.pitch}"
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(req.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={actionLoading !== null}
                                onClick={() => handleResolveJoinRequest(req.id, "approved")}
                                className="bg-green-500/10 border border-green-500/20 text-green-500 hover:bg-green-500/20 shrink-0 font-semibold"
                              >
                                {actionLoading === req.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <Check className="size-4 mr-1" />
                                )}
                                {t("clubPanel.approveMember") || "Approve"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={actionLoading !== null}
                                onClick={() => handleResolveJoinRequest(req.id, "rejected")}
                                className="text-destructive hover:bg-destructive/10 shrink-0 font-semibold"
                              >
                                {actionLoading === req.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <X className="size-4 mr-1" />
                                )}
                                {t("clubPanel.rejectRequest") || "Reject"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending Invitations list */}
          {invitations.length > 0 && (
            <Card className="bg-card border border-border shadow-sm mt-6">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <MailOpen className="size-5 text-primary" />
                  {t("clubPanel.pendingInvitations", { count: invitations.length })}
                </CardTitle>
                <CardDescription>
                  {t("clubPanel.pendingInvitationsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-secondary/35 border-b border-border">
                      <tr>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.emailAddress")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.invitedAt")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("clubPanel.expiresAt")}
                        </th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {invitations.map((invite) => (
                        <tr key={invite.id} className="transition-colors hover:bg-secondary/10">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-medium">
                            {invite.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                            {new Date(invite.created_at).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                            {new Date(invite.expires_at).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={actionLoading !== null}
                              onClick={() => handleRevokeInvitation(invite.id, invite.email)}
                              className="text-destructive hover:bg-destructive/10 shrink-0"
                            >
                              {actionLoading === invite.id ? (
                                <Loader2 className="size-4 animate-spin mr-1" />
                              ) : (
                                <UserMinus className="size-4 mr-1" />
                              )}
                              {t("clubPanel.revokeInvitationTitle") || "Revoke"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
