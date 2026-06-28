import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
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
import { ROUTES } from "@/shared/constants/routes";
import { useAuthState } from "@/features/auth";
import { toast } from "@/shared/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  listOrganizationMemberships,
  updateOrganizationMembership,
  removeOrganizationMembership as removeRosterMembership,
  type OrganizationMembershipWithUser,
} from "@/features/organization-panel/api/memberships.api";
import {
  fetchOrganizationMembers,
  addOrganizationMember,
  removeOrganizationMember as removeOrganizationManager,
  fetchOrganizationInvitations,
  revokeOrganizationInvitation,
  type OrganizationMember,
  type OrganizationInvitation,
} from "../api/members.api";
import {
  fetchJoinRequests,
  resolveJoinRequest,
  type OrganizationJoinRequest,
} from "../api/joinRequests.api";

interface RosterTableHeaderProps {
  columns: string[];
}

function RosterTableHeader({ columns }: RosterTableHeaderProps) {
  const { t } = useTranslation();
  return (
    <thead className="bg-secondary/35 border-b border-border">
      <tr>
        {columns.map((col) => (
          <th
            key={col}
            className="text-xs font-semibold text-muted-foreground px-6 py-4 uppercase tracking-wider"
          >
            {t(`organizationPanel.memberColumns.${col}`)}
          </th>
        ))}
        <th className="px-6 py-4"></th>
      </tr>
    </thead>
  );
}

export function OrganizationPanelMembersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { organizationId } = useAuthState();

  // Navigation tabs
  const [mainTab, setMainTab] = useState<"roster" | "management">("roster");
  const [activeTab, setActiveTab] = useState<"members" | "requests">("members");

  // Roster state
  const [memberships, setMemberships] = useState<OrganizationMembershipWithUser[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Management state
  const [managers, setManagers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [joinRequests, setJoinRequests] = useState<OrganizationJoinRequest[]>([]);
  const [managementLoading, setManagementLoading] = useState(false);

  // Form & Search inputs
  const [emailInput, setEmailInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRoster = useCallback(() => {
    if (!organizationId) return;
    setRosterLoading(true);
    listOrganizationMemberships(organizationId)
      .then((data) => {
        setMemberships(data);
      })
      .catch((err) => {
        console.error("Failed to load organization roster:", err);
        toast({
          description: t("integrations.errors.loadIntegrationsFailed"),
          variant: "destructive",
        });
      })
      .finally(() => {
        setRosterLoading(false);
      });
  }, [organizationId, t]);

  const fetchManagement = useCallback(() => {
    if (!organizationId) return;
    setManagementLoading(true);
    Promise.all([
      fetchOrganizationMembers(organizationId),
      fetchOrganizationInvitations(organizationId),
      fetchJoinRequests(organizationId),
    ])
      .then(([membersData, invitesData, requestsData]) => {
        setManagers(membersData);
        setInvitations(invitesData);
        setJoinRequests(requestsData);
      })
      .catch((err) => {
        console.error("Failed to load management team:", err);
        toast({
          description: t("organizationPanel.loadManagementFailed"),
          variant: "destructive",
        });
      })
      .finally(() => {
        setManagementLoading(false);
      });
  }, [organizationId, t]);

  useEffect(() => {
    if (organizationId) {
      fetchRoster();
      fetchManagement();
    }
  }, [organizationId, fetchRoster, fetchManagement]);

  // Roster Actions
  const handleApproveMembership = async (userId: string) => {
    if (!organizationId) return;
    setActionLoading(userId);
    try {
      await updateOrganizationMembership(organizationId, userId, { status: "approved" });
      toast({
        description: t("organizationPanel.requestApproved"),
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to approve membership:", err);
      toast({
        description: t("organizationPanel.approveMembershipFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectMembership = async (userId: string) => {
    if (!organizationId) return;
    setActionLoading(userId);
    try {
      await updateOrganizationMembership(organizationId, userId, { status: "rejected" });
      toast({
        description: t("organizationPanel.requestRejected"),
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to reject membership:", err);
      toast({
        description: t("organizationPanel.rejectMembershipFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveMembership = async (userId: string) => {
    if (!organizationId) return;
    if (!confirm(t("organizationPanel.removeMemberConfirm"))) {
      return;
    }
    setActionLoading(userId);
    try {
      await removeRosterMembership(organizationId, userId);
      toast({
        description: t("organizationPanel.memberRemoved"),
        variant: "success",
      });
      fetchRoster();
    } catch (err) {
      console.error("Failed to remove member:", err);
      toast({
        description: t("organizationPanel.removeMemberFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Management Actions
  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !emailInput.trim()) return;

    setSubmitting(true);
    try {
      const result = await addOrganizationMember(organizationId, emailInput.trim().toLowerCase());
      if (result && "status" in result && result.status === "pending") {
        toast({
          title: t("common.success"),
          description: t("organizationPanel.invitationSentSuccess", { email: emailInput.trim().toLowerCase() }),
          variant: "success",
        });
      } else {
        toast({
          title: t("common.success"),
          description: t("organizationPanel.addSuccess"),
          variant: "success",
        });
      }
      setEmailInput("");
      fetchManagement();
    } catch (err) {
      console.error("Failed to add manager:", err);
      toast({
        title: t("common.error"),
        description: t("organizationPanel.addManagerFailed"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!organizationId) return;
    if (!confirm(t("organizationPanel.revokeInvitationConfirm", { email }))) {
      return;
    }
    setActionLoading(invitationId);
    try {
      await revokeOrganizationInvitation(organizationId, invitationId);
      toast({
        title: t("common.success"),
        description: t("organizationPanel.invitationRevokedSuccess"),
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
      toast({
        title: t("common.error"),
        description: t("organizationPanel.revokeInvitationFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolveJoinRequest = async (requestId: string, status: "approved" | "rejected") => {
    if (!organizationId) return;
    setActionLoading(requestId);
    try {
      await resolveJoinRequest(organizationId, requestId, status);
      toast({
        title: t("common.success"),
        description: status === "approved"
          ? t("organizationPanel.joinRequestApprovedSuccess")
          : t("organizationPanel.joinRequestRejectedSuccess"),
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error(err);
      toast({
        title: t("common.error"),
        description: t("organizationPanel.joinRequestError"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveManager = async (userId: string, email: string) => {
    if (!organizationId) return;

    const confirmMsg = t("organizationPanel.removeMemberConfirm");
    if (!confirm(`${confirmMsg}\n\nEmail: ${email}`)) {
      return;
    }

    setActionLoading(userId);
    try {
      await removeOrganizationManager(organizationId, userId);
      toast({
        title: t("common.success"),
        description: t("organizationPanel.removeSuccess"),
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
            {t("organizationPanel.roleOwner")}
          </span>
        );
      case "officer":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400">
            {t("organizationPanel.roleOfficer")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground">
            {t("organizationPanel.roleMember")}
          </span>
        );
    }
  };

  if (!organizationId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShieldAlert className="size-12 text-muted-foreground/45 mb-4" />
        <h3 className="font-semibold text-foreground mb-1">
          {t("organizationPanel.noActiveClubSelected")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("organizationPanel.noActiveClubSelectedDesc")}
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
          onMouseDown={() => router.push(ROUTES.ORGANIZATION_PANEL)}
          className="shrink-0"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Users className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("organizationPanel.members")}</h1>
          <p className="text-sm text-muted-foreground">{t("organizationPanel.membersDesc")}</p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex border-b border-border">
        <button
          onMouseDown={() => setMainTab("roster")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            mainTab === "roster"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("organizationPanel.rosterTab")}
        </button>
        <button
          onMouseDown={() => setMainTab("management")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
            mainTab === "management"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("organizationPanel.managementTab")}
        </button>
      </div>

      {/* Tab Contents */}
      {mainTab === "roster" ? (
        <div className="space-y-5">
          {/* Sub Tabs */}
          <div className="flex border-b border-border/60">
            <button
              onMouseDown={() => setActiveTab("members")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "members"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("organizationPanel.activeMembers")} ({activeMembers.length})
            </button>
            <button
              onMouseDown={() => setActiveTab("requests")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "requests"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("organizationPanel.pendingRequests")} ({pendingRequests.length})
            </button>
          </div>

          {/* Roster lists */}
          {rosterLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-primary mb-3" />
              <span className="text-muted-foreground text-sm">{t("organizationPanel.loadingRoster")}</span>
            </div>
          ) : activeTab === "members" ? (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              {activeMembers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <RosterTableHeader columns={["name", "email", "role", "joined"]} />
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
                                  (member.user.full_name || member.user.email || "?").charAt(0)
                                )}
                              </div>
                              <span>{member.user.full_name || member.user.email}</span>
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
                                onMouseDown={() => handleRemoveMembership(member.user.id)}
                                disabled={actionLoading !== null}
                                className="text-destructive hover:bg-destructive/10 shrink-0"
                              >
                                {actionLoading === member.user.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <UserMinus className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.remove")}
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
                    {t("organizationPanel.noMembersYet")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t("organizationPanel.noMembersDesc")}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              {pendingRequests.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <RosterTableHeader columns={["name", "email", "requested"]} />
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
                                  (request.user.full_name || request.user.email || "?").charAt(0)
                                )}
                              </div>
                              <span>{request.user.full_name || request.user.email}</span>
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
                                onMouseDown={() => handleApproveMembership(request.user.id)}
                                disabled={actionLoading !== null}
                                className="bg-green-500/10 border border-green-500/20 text-green-500 hover:bg-green-500/20 shrink-0 font-semibold"
                              >
                                {actionLoading === request.user.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <Check className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.approve")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onMouseDown={() => handleRejectMembership(request.user.id)}
                                disabled={actionLoading !== null}
                                className="text-destructive hover:bg-destructive/10 shrink-0 font-semibold"
                              >
                                {actionLoading === request.user.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <X className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.reject")}
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
                    {t("organizationPanel.noRequestsYet")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t("organizationPanel.noRequestsDesc")}
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
                {t("organizationPanel.inviteOrAddManager")}
              </CardTitle>
              <CardDescription>
                {t("organizationPanel.inviteOrAddManagerDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddManager} className="flex gap-3 max-w-md">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder={t("organizationPanel.enterEmail")}
                  required
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
                />
                <Button type="submit" disabled={submitting || !emailInput.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      {t("organizationPanel.sending")}
                    </>
                  ) : (
                    t("organizationPanel.inviteAddManagerButton")
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
                  {t("organizationPanel.currentlyAuthorizedManagers")}
                </CardTitle>
                <CardDescription>
                  {t("organizationPanel.membersDesc")}
                </CardDescription>
              </div>
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("organizationPanel.searchManagersPlaceholder")}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {managementLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-primary mb-3" />
                  <span className="text-muted-foreground text-sm">
                    {t("organizationPanel.loadingOrganizationMembers")}
                  </span>
                </div>
              ) : filteredManagers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <RosterTableHeader columns={["name", "email", "role", "joined"]} />
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
                                onMouseDown={() => handleRemoveManager(member.user_id, member.email)}
                                disabled={actionLoading !== null}
                                className="text-destructive hover:bg-destructive/10 shrink-0"
                              >
                                {actionLoading === member.user_id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <UserMinus className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.remove")}
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
                    {t("organizationPanel.noMembersYet")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t("organizationPanel.noMembersDesc")}
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
                  {t("organizationPanel.pendingJoinRequests", { count: joinRequests.length })}
                </CardTitle>
                <CardDescription>
                  {t("organizationPanel.pendingJoinRequestsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-secondary/35 border-b border-border">
                      <tr>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.studentNameEmail")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.pitch")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.invitedAt")}
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
                                onMouseDown={() => handleResolveJoinRequest(req.id, "approved")}
                                className="bg-green-500/10 border border-green-500/20 text-green-500 hover:bg-green-500/20 shrink-0 font-semibold"
                              >
                                {actionLoading === req.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <Check className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.approveMember")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={actionLoading !== null}
                                onMouseDown={() => handleResolveJoinRequest(req.id, "rejected")}
                                className="text-destructive hover:bg-destructive/10 shrink-0 font-semibold"
                              >
                                {actionLoading === req.id ? (
                                  <Loader2 className="size-4 animate-spin mr-1" />
                                ) : (
                                  <X className="size-4 mr-1" />
                                )}
                                {t("organizationPanel.reject")}
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
                  {t("organizationPanel.pendingInvitations", { count: invitations.length })}
                </CardTitle>
                <CardDescription>
                  {t("organizationPanel.pendingInvitationsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-secondary/35 border-b border-border">
                      <tr>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.emailAddress")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.invitedAt")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-4">
                          {t("organizationPanel.expiresAt")}
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
                              onMouseDown={() => handleRevokeInvitation(invite.id, invite.email)}
                              className="text-destructive hover:bg-destructive/10 shrink-0"
                            >
                              {actionLoading === invite.id ? (
                                <Loader2 className="size-4 animate-spin mr-1" />
                              ) : (
                                <UserMinus className="size-4 mr-1" />
                              )}
                              {t("organizationPanel.revokeInvitationTitle")}
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
