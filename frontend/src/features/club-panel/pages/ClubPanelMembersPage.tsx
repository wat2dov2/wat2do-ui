import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import {
  Users,
  Loader2,
  UserMinus,
  UserPlus,
  ShieldAlert,
  Search,
  MailOpen,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { EmptyState } from "@/shared/feedback";
import { useAuthState } from "@/features/auth";
import { toast } from "@/shared/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  fetchClubMembers,
  addClubMember,
  removeClubMember as removeClubManager,
  fetchClubInvitations,
  revokeClubInvitation,
  type ClubMember,
  type ClubInvitation,
} from "../api/members.api";

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
            className="text-xs font-semibold text-muted-foreground px-6 py-4"
          >
            {t(`clubPanel.memberColumns.${col}`)}
          </th>
        ))}
        <th className="px-6 py-4"></th>
      </tr>
    </thead>
  );
}

export function ClubPanelMembersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId } = useAuthState();

  const [managers, setManagers] = useState<ClubMember[]>([]);
  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const [managementLoading, setManagementLoading] = useState(false);

  const [emailInput, setEmailInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchManagement = useCallback(() => {
    if (!clubId) return;
    setManagementLoading(true);
    Promise.all([
      fetchClubMembers(clubId),
      fetchClubInvitations(clubId),
    ])
      .then(([membersData, invitesData]) => {
        setManagers(membersData);
        setInvitations(invitesData);
      })
      .catch((err) => {
        console.error("Failed to load management team:", err);
        toast({
          description: t("clubPanel.loadManagementFailed"),
          variant: "destructive",
        });
      })
      .finally(() => {
        setManagementLoading(false);
      });
  }, [clubId, t]);

  useEffect(() => {
    if (clubId) {
      fetchManagement();
    }
  }, [clubId, fetchManagement]);

  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId || !emailInput.trim()) return;

    setSubmitting(true);
    try {
      const result = await addClubMember(clubId, emailInput.trim().toLowerCase());
      if (result && "status" in result && result.status === "pending") {
        toast({
          title: t("common.success"),
          description: t("clubPanel.invitationSentSuccess", { email: emailInput.trim().toLowerCase() }),
          variant: "success",
        });
      } else {
        toast({
          title: t("common.success"),
          description: t("clubPanel.addSuccess"),
          variant: "success",
        });
      }
      setEmailInput("");
      fetchManagement();
    } catch (err) {
      console.error("Failed to add manager:", err);
      toast({
        title: t("common.error"),
        description: t("clubPanel.addManagerFailed"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!clubId) return;
    if (!confirm(t("clubPanel.revokeInvitationConfirm", { email }))) {
      return;
    }
    setActionLoading(invitationId);
    try {
      await revokeClubInvitation(clubId, invitationId);
      toast({
        title: t("common.success"),
        description: t("clubPanel.invitationRevokedSuccess"),
        variant: "success",
      });
      fetchManagement();
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
      toast({
        title: t("common.error"),
        description: t("clubPanel.revokeInvitationFailed"),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveManager = async (userId: string, email: string) => {
    if (!clubId) return;

    const confirmMsg = t("clubPanel.removeMemberConfirm");
    if (!confirm(`${confirmMsg}\n\nEmail: ${email}`)) {
      return;
    }

    setActionLoading(userId);
    try {
      await removeClubManager(clubId, userId);
      toast({
        title: t("common.success"),
        description: t("clubPanel.removeSuccess"),
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

  const filteredManagers = managers.filter((member) => {
    const q = searchQuery.toLowerCase();
    const name = (member.full_name || "").toLowerCase();
    const email = (member.email || "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

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
      <EmptyState
        icon={<ShieldAlert />}
        title={t("clubPanel.noActiveClubSelected")}
        description={t("clubPanel.noActiveClubSelectedDesc")}
      />
    );
  }

  return (
    <Stack gap={5}>
      <PageHeader
        back={{
          label: t("clubPanel.backToPanel"),
          onClick: () => router.push(ROUTES.CLUB_PANEL),
        }}
        icon={Users}
        title={t("clubPanel.members")}
        description={t("clubPanel.membersDesc")}
      />

      <Stack gap={6}>
          <Card className="bg-surface border border-border shadow-sm">
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
                  placeholder={t("clubPanel.enterEmail")}
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

          <Card className="bg-surface border border-border shadow-sm">
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
                  placeholder={t("clubPanel.searchManagersPlaceholder")}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {managementLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-primary mb-3" />
                  <span className="text-muted-foreground text-sm">
                    {t("clubPanel.loadingClubMembers")}
                  </span>
                </div>
              ) : filteredManagers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <RosterTableHeader columns={["name", "email", "role", "joined"]} />
                    <tbody className="divide-y divide-border/60">
                      {filteredManagers.map((member) => (
                        <tr key={member.user_id} className="hover:bg-surface-hover transition-colors">
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
                                className="text-destructive hover:bg-surface-hover shrink-0"
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

          {invitations.length > 0 && (
            <Card className="bg-surface border border-border shadow-sm mt-6">
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
                        <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-4">
                          {t("clubPanel.emailAddress")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-4">
                          {t("clubPanel.invitedAt")}
                        </th>
                        <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-4">
                          {t("clubPanel.expiresAt")}
                        </th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {invitations.map((invite) => (
                        <tr key={invite.id} className="transition-colors hover:bg-surface-hover">
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
                              className="text-destructive hover:bg-surface-hover shrink-0"
                            >
                              {actionLoading === invite.id ? (
                                <Loader2 className="size-4 animate-spin mr-1" />
                              ) : (
                                <UserMinus className="size-4 mr-1" />
                              )}
                              {t("clubPanel.revokeInvitationTitle")}
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
      </Stack>
    </Stack>
  );
}
