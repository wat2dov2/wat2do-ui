import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Users, UserPlus, UserMinus, Search, MailOpen } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Spinner } from "@/shared/ui/spinner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/shared/ui/card";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { useAuthState } from "@/features/auth";
import { getMyClubs } from "@/features/clubs";
import type { Club } from "@/shared/types";
import {
  fetchClubMembers,
  addClubMember,
  removeClubMember,
  fetchClubInvitations,
  revokeClubInvitation,
  type ClubMember,
  type ClubInvitation,
} from "../api/members.api";
import { toast } from "@/shared/hooks/use-toast";

export function ClubPanelMembersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clubId: activeClubId, userEmail } = useAuthState();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);


  const [emailInput, setEmailInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Resolve the active club
  const selectedClub = clubs.find((club) => club.id === activeClubId) ?? clubs[0] ?? null;
  const selectedClubId = selectedClub?.id ?? null;

  // 1. Load clubs on boot
  useEffect(() => {
    let cancelled = false;
    async function loadClubs() {
      try {
        const clubsData = await getMyClubs();
        if (!cancelled) {
          setClubs(clubsData);
        }
      } catch (err) {
        console.error("Failed to load user clubs:", err);
      }
    }
    void loadClubs();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Load members & invitations whenever selectedClubId changes
  useEffect(() => {
    if (!selectedClubId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const [membersData, invitesData] = await Promise.all([
          fetchClubMembers(selectedClubId!),
          fetchClubInvitations(selectedClubId!)
        ]);
        if (!cancelled) {
          setMembers(membersData);
          setInvitations(invitesData);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch club members/invitations:", err);
          toast({
            title: "Error",
            description: "Failed to load club members.",
            variant: "destructive"
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedClubId]);

  // 3. Handle Add Member / Send Invitation
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClubId || !emailInput.trim()) return;

    try {
      const result = await addClubMember(selectedClubId, emailInput.trim().toLowerCase());
      if (result && 'status' in result && result.status === 'pending') {
        toast({
          title: "Success",
          description: `Invitation sent to ${emailInput.trim().toLowerCase()}!`,
          variant: "success"
        });
      } else {
        toast({
          title: "Success",
          description: t("clubPanel.addSuccess") || "Member added successfully!",
          variant: "success"
        });
      }
      setEmailInput("");

      // Reload lists
      const [updatedMembers, updatedInvites] = await Promise.all([
        fetchClubMembers(selectedClubId),
        fetchClubInvitations(selectedClubId)
      ]);
      setMembers(updatedMembers);
      setInvitations(updatedInvites);
    } catch (err) {
      console.error(err);
      const errorObj = err as { response?: { data?: { detail?: string } }; message?: string };
      const detail = errorObj?.response?.data?.detail || errorObj?.message || "Failed to add member.";
      toast({
        title: "Error",
        description: detail,
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Handle Revoke Invitation
  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!selectedClubId) return;

    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) {
      return;
    }

    try {
      await revokeClubInvitation(selectedClubId, invitationId);
      toast({
        title: "Success",
        description: "Invitation revoked successfully!",
        variant: "success"
      });

      // Reload invitations list
      const updatedInvites = await fetchClubInvitations(selectedClubId);
      setInvitations(updatedInvites);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to revoke invitation.",
        variant: "destructive"
      });
    }
  };

  // 4. Handle Remove Member
  const handleRemoveMember = async (userId: string, email: string) => {
    if (!selectedClubId) return;

    const confirmMsg = t("clubPanel.removeMemberConfirm") || `Are you sure you want to remove this member?`;
    if (!confirm(`${confirmMsg}\n\nEmail: ${email}`)) {
      return;
    }

    setRemovingUserId(userId);

    try {
      await removeClubMember(selectedClubId, userId);
      toast({
        title: "Success",
        description: t("clubPanel.removeSuccess") || "Member removed successfully!",
        variant: "success"
      });

      // Reload members list
      const updatedMembers = await fetchClubMembers(selectedClubId);
      setMembers(updatedMembers);
    } catch (err) {
      console.error(err);
      const errorObj = err as { response?: { data?: { detail?: string } }; message?: string };
      const detail = errorObj?.response?.data?.detail || errorObj?.message || "Failed to remove member.";
      toast({
        title: "Error",
        description: detail,
        variant: "destructive"
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  // 5. Helper functions for initials & avatar backgrounds
  function getInitials(member: ClubMember): string {
    if (member.full_name) {
      const parts = member.full_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    if (member.username) {
      return member.username[0].toUpperCase();
    }
    return member.email[0].toUpperCase();
  }

  function getAvatarBg(email: string): string {
    const colors = [
      "bg-red-500/10 text-red-500 border-red-500/20",
      "bg-blue-500/10 text-blue-500 border-blue-500/20",
      "bg-green-500/10 text-green-500 border-green-500/20",
      "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      "bg-purple-500/10 text-purple-500 border-purple-500/20",
      "bg-pink-500/10 text-pink-500 border-pink-500/20",
      "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
      "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
    ];
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  // Filter members list based on search query
  const filteredMembers = members.filter((member) => {
    const query = searchQuery.toLowerCase();
    return (
      member.email.toLowerCase().includes(query) ||
      (member.full_name && member.full_name.toLowerCase().includes(query)) ||
      (member.username && member.username.toLowerCase().includes(query))
    );
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate(ROUTES.CLUB_PANEL)}
          className="shrink-0 transition-transform duration-200 hover:-translate-x-1"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
          <Users className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("clubPanel.members")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("clubPanel.membersDesc")}
          </p>
        </div>
      </div>

      {/* Main Grid Layout */}
      {!selectedClubId ? (
        <Card className="text-center p-12">
          <Users className="size-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
          <CardTitle className="mb-2">{t("clubPanel.noActiveClubSelected")}</CardTitle>
          <CardDescription>
            {t("clubPanel.noActiveClubSelectedDesc")}
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Add Member Form */}
          <Card className="lg:col-span-1 h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <UserPlus className="size-5 text-primary" />
                {t("clubPanel.inviteOrAddManager")}
              </CardTitle>
              <CardDescription>
                {t("clubPanel.inviteOrAddManagerDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddMember} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    type="email"
                    required
                    placeholder={t("clubPanel.enterEmail") || "Enter email address"}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="h-10"
                    disabled={submitting}
                  />
                </div>
                <Button type="submit" className="w-full h-10 font-medium" disabled={submitting || !emailInput.trim()}>
                  {submitting ? (
                    <>
                      <Spinner className="size-4 mr-2" />
                      {t("clubPanel.sending")}
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-4 mr-2" />
                      {t("clubPanel.inviteAddManagerButton")}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Right Column: Members List */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="size-5 text-primary" />
                  {t("clubPanel.members")} ({members.length})
                </CardTitle>
                <CardDescription>
                  {t("clubPanel.currentlyAuthorizedManagers")} {selectedClub.club_name}.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("clubPanel.searchManagersPlaceholder") || "Search managers by name or email..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 bg-secondary/50 border-none focus-visible:ring-primary/30"
                />
              </div>

              {/* Loading State */}
              {loading ? (
                <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
                  <Spinner className="size-8 text-primary" />
                  <p className="text-sm text-muted-foreground animate-pulse">{t("clubPanel.loadingClubMembers")}</p>
                </div>
              ) : filteredMembers.length === 0 ? (
                /* Empty state */
                <div className="p-12 text-center border border-dashed border-border rounded-xl">
                  <Users className="size-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="font-semibold text-foreground mb-1">
                    {searchQuery ? "No matching members" : t("clubPanel.noMembersYet")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {searchQuery
                      ? "Try searching for a different name or email address."
                      : t("clubPanel.noMembersDesc")}
                  </p>
                </div>
              ) : (
                /* Members List / Table */
                <div className="border border-border rounded-xl overflow-hidden bg-card/50">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead className="bg-secondary/40 border-b border-border">
                        <tr>
                          <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                            {t("clubPanel.memberColumns.name")}
                          </th>
                          <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                            {t("clubPanel.memberColumns.email")}
                          </th>
                          <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                            {t("clubPanel.memberColumns.role")}
                          </th>
                          <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                            {t("clubPanel.memberColumns.joined")}
                          </th>
                          <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                            {t("clubPanel.actions") || "Actions"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {filteredMembers.map((member) => {
                          const isSelf = member.email.toLowerCase() === userEmail?.toLowerCase();
                          const isRemoving = removingUserId === member.user_id;

                          return (
                            <tr key={member.user_id} className="transition-colors hover:bg-secondary/20">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-3">
                                  {member.avatar_url ? (
                                    <img
                                      src={member.avatar_url}
                                      alt={member.full_name || member.username || "Avatar"}
                                      className="size-8 rounded-full object-cover border border-border"
                                    />
                                  ) : (
                                    <div className={`size-8 rounded-full border flex items-center justify-center font-medium text-xs ${getAvatarBg(member.email)}`}>
                                      {getInitials(member)}
                                    </div>
                                  )}
                                  <div>
                                    <div className="text-sm font-semibold text-foreground">
                                      {member.full_name || member.username || "Manager"}
                                    </div>
                                    {member.username && (
                                      <div className="text-xs text-muted-foreground">@{member.username}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                                {member.email}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <Badge variant="secondary" className="capitalize">
                                  {member.role.toLowerCase()}
                                </Badge>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                {new Date(member.joined_at).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  disabled={isSelf || isRemoving || !!removingUserId}
                                  onClick={() => handleRemoveMember(member.user_id, member.email)}
                                  title={isSelf ? "You cannot remove yourself" : "Remove manager"}
                                  className="transition-colors hover:bg-error hover:text-error-foreground"
                                >
                                  {isRemoving ? <Spinner className="size-4" /> : <UserMinus className="size-4" />}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Pending Invitations list */}
              {invitations.length > 0 && (
                <div className="space-y-4 pt-6 border-t border-border mt-6">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <MailOpen className="size-4 text-primary" />
                      {t("clubPanel.pendingInvitations", { count: invitations.length })}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {t("clubPanel.pendingInvitationsDesc")}
                    </p>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden bg-card/50">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="bg-secondary/40 border-b border-border">
                          <tr>
                            <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                              {t("clubPanel.emailAddress")}
                            </th>
                            <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                              {t("clubPanel.invitedAt")}
                            </th>
                            <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                              {t("clubPanel.expiresAt")}
                            </th>
                            <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-6 py-3">
                              {t("clubPanel.actions")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {invitations.map((invite) => (
                            <tr key={invite.id} className="transition-colors hover:bg-secondary/20">
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
                                  variant="destructive"
                                  size="icon"
                                  onClick={() => handleRevokeInvitation(invite.id, invite.email)}
                                  title={t("clubPanel.revokeInvitationTitle") || "Revoke invitation"}
                                  className="transition-colors hover:bg-error hover:text-error-foreground"
                                >
                                  <UserMinus className="size-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
