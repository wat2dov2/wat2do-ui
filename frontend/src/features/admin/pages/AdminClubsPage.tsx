import { ClaimDetailsDrawer } from "@/features/admin/components/ClaimDetailsDrawer";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Building2, ExternalLink, ShieldAlert } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  TableCell,
  TableRow,
} from "@/shared/ui/table";
import type { Club, ClubStatus, SubmissionStatus } from "@/shared/types";
import { AddClubModal } from "@/features/clubs";
import { useAdminClubsPage } from "@/features/admin/hooks/useAdminClubsPage";
import {
  adminCreateClub,
  adminUpdateClub,
  adminDeleteClub,
} from "@/features/admin/api/admin.api";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useAdminList, useAdminPendingCounts } from "@/features/admin/hooks/useAdminList";
import { getClubClaims, getClubSubmissions, resolveClaim, resolveClubReview } from "@/features/admin/api/admin.api";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { LoadingPage } from "@/shared/ui/loading-page";
import { toast } from "@/shared/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { ClubCategoryBadges } from "@/features/clubs/components/ClubCategoryBadges";
import {
  getClubTypeFilterOptions,
  INDEPENDENT_CLUB_TYPE,
} from "@/shared/data/clubTypeAssets";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { QP } from "@/shared/constants/queryParams";

const ALL_CLUB_TYPES_VALUE = "__all_club_types__";

interface AdminClubsPageProps {
  onBack: () => void;
}

export function AdminClubsPage({
  onBack,
}: AdminClubsPageProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolName, getSchoolTimezone } = useSchoolDirectory();
  const {
    searchQuery,
    clubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubs,
    totalItems,
    totalPages,
    isLoading,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setClubType,
    setDeleteConfirmId,
    openAddModal,
    openEditModal,
    closeModal,
    setCurrentPage,
    refreshClubs,
  } = useAdminClubsPage();

  const [searchParams] = useMutableSearchParams();
  const [activeTab, setActiveTab] = useState<"clubs" | "claims" | "submissions">(
    searchParams.get(QP.TAB) === "claims" ? "claims"
      : searchParams.get(QP.TAB) === "submissions" ? "submissions" : "clubs",
  );

  const queryClient = useQueryClient();
  const claimList = useAdminList("claims", getClubClaims, activeTab === "claims");
  const submissionList = useAdminList("clubSubmissions", getClubSubmissions, activeTab === "submissions");
  const moderationList = activeTab === "claims" ? claimList : submissionList;
  const { counts } = useAdminPendingCounts(["claims", "clubSubmissions"]);
  const pendingClaimsCount = counts.claims;
  const pendingSubmissionCount = counts.clubSubmissions;
  const claimSearchQuery = moderationList.filters.search ?? "";
  const moderationSchool = moderationList.filters.school ?? "";
  const claimStatusFilter = moderationList.filters.status ?? "all";
  const setClaimSearchQuery = (search: string) => moderationList.setFilters({ search });
  const setModerationSchool = (school: string) => moderationList.setFilters({ school });
  const setClaimStatusFilter = (status: string) => moderationList.setFilters({ status });
  const claimsPagination = claimList.pagination;
  const [isDeleting, setIsDeleting] = useState(false);
  const clubTypeOptions = useMemo(() => getClubTypeFilterOptions(undefined), []);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const selectedClaim = claimList.items.find(claim => claim.id === selectedClaimId);
  const [rejectClaimId, setRejectClaimId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const refreshClubQueries = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
    refreshClubs(),
  ]);

  const handleReviewClub = async (
    clubId: number,
    status: ClubStatus,
  ) => {
    try {
      await resolveClubReview(clubId, status);
      await refreshClubQueries();
    } catch (error) {
      console.error("Failed to review club:", error);
    }
  };

  const handleDelete = async (clubId: number) => {
    setIsDeleting(true);
    try {
      await adminDeleteClub(clubId);
      await refreshClubQueries();
    } catch (error) {
      console.error("Failed to delete club:", error);
    } finally {
      setDeleteConfirmId(null);
      setIsDeleting(false);
    }
  };

  const handleSave = async (club: Club) => {
    try {
      if (editingClub) {
        await adminUpdateClub(club);
      } else {
        await adminCreateClub(club);
      }
      await refreshClubQueries();
      closeModal();
    } catch (error) {
      console.error("Failed to save club:", error);
    }
  };

  const handleApproveClaim = async (claimId: string) => {
    try {
      await resolveClaim(claimId, "approved");
      await refreshClubQueries();
      toast({
        title: t("common.success"),
        description: t("admin.claimApprovedSuccess"),
        variant: "success",
      });
    } catch (error) {
      console.error("Failed to approve claim:", error);
      toast({
        title: t("common.error"),
        description: t("admin.claimApprovedError"),
        variant: "destructive",
      });
    }
  };

  const handleRejectClaim = async () => {
    if (!rejectClaimId) return;
    setSubmittingResolution(true);
    try {
      await resolveClaim(rejectClaimId, "rejected", rejectionReason);
      await refreshClubQueries();
      toast({
        title: t("common.success"),
        description: t("admin.claimRejectedSuccess"),
        variant: "success",
      });
      setRejectClaimId(null);
      setRejectionReason("");
    } catch (error) {
      console.error("Failed to reject claim:", error);
      toast({
        title: t("common.error"),
        description: t("admin.claimRejectedError"),
        variant: "destructive",
      });
    } finally {
      setSubmittingResolution(false);
    }
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) =>
        setActiveTab(value as "clubs" | "claims" | "submissions")
      }
      className="space-y-5"
    >
      <AdminPageHeader
        icon={Building2}
        title={t("admin.manageClubs")}
        description={t("admin.manageClubsDesc")}
        onBack={onBack}
        action={
          activeTab === "clubs"
            ? {
                label: t("clubs.addClub"),
                onClick: openAddModal,
              }
            : undefined
        }
      />

      <div className="space-y-5 pb-2">
        <TabsList>
          <TabsTrigger value="clubs">
            {t("admin.clubsList")}
          </TabsTrigger>
          <TabsTrigger value="claims" count={pendingClaimsCount}>
            {t("admin.claimRequests")}
          </TabsTrigger>
          <TabsTrigger value="submissions" count={pendingSubmissionCount}>
            {t("admin.clubSubmissions")}
          </TabsTrigger>
        </TabsList>

        {activeTab === "clubs" ? (
          <>
            <div className="flex gap-3">
              <AdminSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSubmit={submitSearchQuery}
                onClear={clearSearchQuery}
                placeholder={t("clubs.searchPlaceholder")}
                submitLabel={t("common.search")}
                clearLabel={t("clubs.clearSearch")}
              />
              <Select
                value={clubType ?? ALL_CLUB_TYPES_VALUE}
                onValueChange={(value) =>
                  setClubType(
                    value === ALL_CLUB_TYPES_VALUE ? undefined : value,
                  )
                }
              >
                <SelectTrigger size="lg">
                  <SelectValue placeholder={t("admin.allClubTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CLUB_TYPES_VALUE}>
                    {t("admin.allClubTypes")}
                  </SelectItem>
                  {clubTypeOptions.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type === INDEPENDENT_CLUB_TYPE
                        ? t("admin.clubTypeIndependent")
                        : type.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <AdminTableFilters
                search={claimSearchQuery}
                school={moderationSchool}
                onSchoolChange={setModerationSchool}
                onSearchChange={setClaimSearchQuery}
              >
              <Select
                value={claimStatusFilter}
                onValueChange={setClaimStatusFilter}
              >
                <SelectTrigger size="lg">
                  <SelectValue placeholder={t("admin.allStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.allStatus")}</SelectItem>
                  <SelectItem value="pending">{t("admin.pending")}</SelectItem>
                  <SelectItem value="approved">{t("admin.approved")}</SelectItem>
                  <SelectItem value="rejected">{t("admin.rejected")}</SelectItem>
                </SelectContent>
              </Select>
            </AdminTableFilters>
          </>
        )}
      </div>

      {activeTab === "submissions" ? (
        <>
          {submissionList.isError ? <Button onClick={() => void submissionList.refetch()}>{t("common.tryAgain")}</Button> : submissionList.isPending ? (
            <LoadingPage />
          ) : submissionList.total > 0 ? (
            <AdminTable pagination={submissionList.pagination} count={submissionList.total} label={submissionList.total === 1 ? t("admin.submission") : t("admin.submissions")}
              headers={[
                { label: t("forms.clubName") },
                { label: t("schools.school") },
                { label: t("forms.ownerEmail") },
                { label: t("admin.clubType") },
                { label: t("admin.status") },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {submissionList.items.map((club) => (
                <TableRow key={club.id}>
                  <TableCell>
                    <div className="font-medium text-sm text-foreground">
                      {club.club_name}
                    </div>
                  </TableCell>
                  <TableCell>{getSchoolName(club.school)}</TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {club.owner_email ?? "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {club.club_type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AdminStatusBadge status={club.status as SubmissionStatus} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {club.status !== "approved" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleReviewClub(club.id, "approved")}
                          className="text-primary hover:bg-surface-hover border border-transparent"
                        >
                          {t("admin.approve")}
                        </Button>
                      )}
                      {club.status !== "rejected" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleReviewClub(club.id, "rejected")}
                          className="text-destructive hover:bg-surface-hover border border-transparent"
                        >
                          {t("admin.reject")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </AdminTable>
          ) : (
            <AdminEmptyState
              icon={ShieldAlert}
              title={t("admin.noClubSubmissions")}
              description={t("admin.noClubSubmissionsDesc")}
            />
          )}
        </>
      ) : activeTab === "clubs" ? (
        <>
          {isLoading ? (
            <LoadingPage />
          ) : totalItems > 0 ? (
            <AdminTable count={totalItems} label={totalItems === 1 ? t("admin.club") : t("navigation.clubs")}
              pagination={{ currentPage, totalPages, onPageChange: setCurrentPage }}
              headers={[
                { label: t("forms.clubName") },
                { label: t("forms.categories") },
                { label: t("admin.clubType") },
                { label: t("forms.ownerEmail") },
                { label: t("admin.instagram") },
                { label: t("admin.discord") },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {clubs.map((org) => (
                <TableRow
                  key={org.id}
                  className="cursor-pointer"
                  onClick={() => openEditModal(org)}
                >
                  <TableCell>
                    <div className="font-medium text-sm text-foreground">
                      {org.club_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ClubCategoryBadges
                      categories={org.categories}
                      maxVisible={2}
                      badgeClassName="h-5 text-[11px]"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {org.club_type === INDEPENDENT_CLUB_TYPE
                        ? t("admin.clubTypeIndependent")
                        : org.club_type.toUpperCase()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[140px] truncate text-xs text-muted-foreground">
                      {org.owner_email || org.created_by || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {org.ig ? (
                      <span className="text-sm text-muted-foreground">@{org.ig}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {org.discord ? (
                      <span className="max-w-[100px] truncate text-sm text-muted-foreground">{org.discord}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(org);
                        }}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(org.id);
                        }}
                        className="hover:bg-surface-hover hover:text-destructive"
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </AdminTable>
          ) : (
            <AdminEmptyState
              icon={Building2}
              title={t("admin.noClubsFound")}
              description={t("admin.noClubsMatchFilters")}
            />
          )}
        </>
      ) : (
        <>
          {claimList.isError ? <Button onClick={() => void claimList.refetch()}>{t("common.tryAgain")}</Button> : claimList.isPending ? (
            <LoadingPage />
          ) : claimList.total > 0 ? (
            <>
              <AdminTable count={claimList.total} label={claimList.total === 1 ? t("admin.claimRequest") : t("admin.claimRequests")}
              pagination={{ currentPage: claimsPagination.currentPage, totalPages: claimsPagination.totalPages, onPageChange: claimsPagination.onPageChange }}
                headers={[
                  { label: t("forms.clubName") },
                  { label: t("admin.requestedBy") },
                  { label: t("schools.school") },
                  { label: t("admin.executiveRole") },
                  { label: <span className="flex items-center gap-1"><ExternalLink className="size-3" />{t("admin.proofUrl")}</span> },
                  { label: t("admin.submittedAt") },
                  { label: t("admin.status") },
                  { label: t("common.actions"), align: "right" },
                ]}
              >
                {claimList.items.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell>
                      <div className="font-semibold text-sm text-foreground">
                        {claim.clubs?.club_name || `Club #${claim.club_id}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-foreground">
                        {claim.users?.full_name || "Applicant"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {claim.users?.email}
                      </div>
                    </TableCell>
                    <TableCell>{claim.clubs?.school ? getSchoolName(claim.clubs.school) : t("admin.unknown")}</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 bg-primary/10 rounded text-primary font-medium">
                        {claim.executive_role}
                      </span>
                    </TableCell>
                    <TableCell>
                      {claim.proof_url ? (
                        <a
                          href={claim.proof_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          <span>{t("admin.viewProof")}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("admin.noProofProvided")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {new Date(claim.created_at).toLocaleDateString(i18n.language, { timeZone: getSchoolTimezone(claim.clubs?.school) })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        <AdminStatusBadge status={claim.status as SubmissionStatus} />
                        {claim.status === "rejected" && claim.rejection_reason && (
                          <span className="text-[10px] text-destructive font-medium max-w-[150px] truncate" title={claim.rejection_reason}>
                            {t("admin.rejectionReason")}: {claim.rejection_reason}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setSelectedClaimId(claim.id)}>{t("common.view")}</Button>
                        {claim.status === "pending" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleApproveClaim(claim.id)}
                              className="text-primary hover:bg-surface-hover border border-transparent"
                            >
                              {t("admin.approve")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRejectClaimId(claim.id)}
                              className="text-destructive hover:bg-surface-hover border border-transparent"
                            >
                              {t("admin.reject")}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </AdminTable>
            </>
          ) : (
            <AdminEmptyState
              icon={ShieldAlert}
              title={t("admin.noClaimsFound")}
              description={t("admin.noClaimsMatchFilters")}
            />
          )}
        </>
      )}

      {selectedClaim && <ClaimDetailsDrawer claim={selectedClaim} onClose={() => setSelectedClaimId(null)} />}
      <AdminDeleteDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId != null && handleDelete(deleteConfirmId)}
        title={t("admin.deleteClub")}
        description={t("admin.deleteClubConfirm")}
        isLoading={isDeleting}
      />

      <AddClubModal
        isOpen={showAddModal}
        onClose={closeModal}
        onSave={handleSave}
        initialData={editingClub || undefined}
      />

      <Dialog open={rejectClaimId !== null} onOpenChange={(open) => !open && setRejectClaimId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.rejectClubClaim")}</DialogTitle>
            <DialogDescription>
              {t("admin.rejectClaimDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Textarea
              placeholder={t("admin.rejectionPlaceholder")}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRejectClaimId(null)} disabled={submittingResolution}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectClaim}
              disabled={submittingResolution || !rejectionReason.trim()}
            >
              {t("admin.rejectRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
