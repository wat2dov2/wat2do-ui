import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getClubById } from "@/features/clubs";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useRouter } from "next/navigation";
import {
  Users,
  UserMinus,
  UserPlus,
  ShieldAlert,
  Search,
  MailOpen,
} from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LazyImage } from "@/shared/ui/lazy-image";
import { TableSkeletonRows } from "@/shared/ui/table";
import { Spinner } from "@/shared/ui/spinner";
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
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { clubId } = useAuthState();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { data: club } = useQuery({
    queryKey: queryKeys.clubs.detail(clubId ?? 0),
    queryFn: () => getClubById(clubId!),
    enabled: clubId != null,
  });
  const formatDate = (value: string) => club
    ? new Date(value).toLocaleDateString(i18n.language, { dateStyle: "medium", timeZone: getSchoolTimezone(club.school) })
    : "";

  const [management, setManagement] = useState<{
    clubId: number | null;
    managers: ClubMember[];
    invitations: ClubInvitation[];
    loading: boolean;
  }>({ clubId: null, managers: [], invitations: [], loading: false });
  const [managementRevision, setManagementRevision] = useState(0);
  const managers = management.clubId === clubId ? management.managers : [];
  const invitations = management.clubId === clubId ? management.invitations : [];
  const managementLoading = management.clubId !== clubId || management.loading;

  const [emailInput, setEmailInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchManagement = useCallback(() => {
    setManagementRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setManagement((current) => current.clubId === clubId
      ? { ...current, loading: true }
      : { clubId, managers: [], invitations: [], loading: true });
    Promise.all([
      fetchClubMembers(clubId),
      fetchClubInvitations(clubId),
    ])
      .then(([membersData, invitesData]) => {
        if (cancelled) return;
        setManagement({ clubId, managers: membersData, invitations: invitesData, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load management team:", err);
        toast({
          description: t("clubPanel.loadManagementFailed"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setManagement((current) => ({ ...current, loading: false }));
      });
    return () => { cancelled = true; };
  }, [clubId, managementRevision, t]);

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
                      <Spinner />
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
                <div className="overflow-x-auto" role="status" aria-busy="true" aria-label={t("clubPanel.loadingClubMembers")}>
                  <table className="w-full border-collapse text-left">
                    <RosterTableHeader columns={["name", "email", "role", "joined"]} />
                    <tbody><TableSkeletonRows columns={5} /></tbody>
                  </table>
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
                                  <LazyImage
                                    src={member.avatar_url}
                                    alt={member.full_name || ""}
                                    width={32}
                                    height={32}
                                    className="size-full"
                                    fallback={getInitials(member.full_name, member.email)}
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
                            {formatDate(member.joined_at)}
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
                                  <Spinner />
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
                            {formatDate(invite.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(invite.expires_at)}
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
                                <Spinner />
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
