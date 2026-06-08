import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Users, Plus, Instagram, MessageCircle, ExternalLink, ShieldAlert } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
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
import type { Club } from "@/shared/types";
import { AddOrganizationModal } from "@/features/organizations";
import { useAdminOrganizationsPage } from "@/features/admin/hooks/useAdminOrganizationsPage";
import {
  adminCreateOrganization,
  adminUpdateOrganization,
  adminDeleteOrganization,
} from "@/features/admin/api/admin.api";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { Pagination } from "@/shared/ui/Pagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { LoadingPage } from "@/shared/ui/loading-page";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { toast } from "@/shared/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;
const ALL_CLUB_TYPES_VALUE = "__all_club_types__";

interface AdminOrganizationsPageProps {
  onBack: () => void;
}

export function AdminOrganizationsPage({
  onBack,
}: AdminOrganizationsPageProps) {
  const { t } = useTranslation();
  const {
    searchQuery,
    selectedClubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubTypes,
    filteredOrganizations,
    paginatedClubs,
    totalPages,
    isLoading,
    setSearchQuery,
    setSelectedClubType,
    setDeleteConfirmId,
    openAddModal,
    openEditModal,
    closeModal,
    setCurrentPage,
    refreshClubs,
  } = useAdminOrganizationsPage({ itemsPerPage: ITEMS_PER_PAGE });

  const [activeTab, setActiveTab] = useState<"clubs" | "claims">("clubs");
  
  // Load claims from Zustand store
  const pendingClaims = useAdminStore((s) => s.claims);
  const fetchClaims = useAdminStore((s) => s.fetchClaims);
  const approveClaimAction = useAdminStore((s) => s.approveClaim);
  const rejectClaimAction = useAdminStore((s) => s.rejectClaim);

  const [loadingClaims, setLoadingClaims] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Rejection Dialog State
  const [rejectClaimId, setRejectClaimId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submittingResolution, setSubmittingResolution] = useState(false);

  const visibleClubTypes = clubTypes.filter((type) => type.trim().length > 0);

  const loadClaimsData = async () => {
    setLoadingClaims(true);
    try {
      await fetchClaims();
    } catch (error) {
      console.error("Failed to load pending claims:", error);
    } finally {
      setLoadingClaims(false);
    }
  };

  useEffect(() => {
    void loadClaimsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === "claims") {
      void loadClaimsData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleDelete = async (clubId: number) => {
    setIsDeleting(true);
    try {
      await adminDeleteOrganization(clubId);
      await refreshClubs();
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
        await adminUpdateOrganization(club);
      } else {
        await adminCreateOrganization(club);
      }
      await refreshClubs();
      closeModal();
    } catch (error) {
      console.error("Failed to save club:", error);
    }
  };

  const handleApproveClaim = async (claimId: string) => {
    try {
      await approveClaimAction(claimId);
      toast({
        title: t("common.success") || "Success",
        description: t("admin.claimApprovedSuccess"),
        variant: "success",
      });
    } catch (error) {
      console.error("Failed to approve claim:", error);
      toast({
        title: t("common.error") || "Error",
        description: t("admin.claimApprovedError"),
        variant: "destructive",
      });
    }
  };

  const handleRejectClaim = async () => {
    if (!rejectClaimId) return;
    setSubmittingResolution(true);
    try {
      await rejectClaimAction(rejectClaimId, rejectionReason);
      toast({
        title: t("common.success") || "Success",
        description: t("admin.claimRejectedSuccess"),
        variant: "success",
      });
      setRejectClaimId(null);
      setRejectionReason("");
    } catch (error) {
      console.error("Failed to reject claim:", error);
      toast({
        title: t("common.error") || "Error",
        description: t("admin.claimRejectedError"),
        variant: "destructive",
      });
    } finally {
      setSubmittingResolution(false);
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Users}
        title={t("admin.manageClubs")}
        description={t("admin.manageClubsDesc")}
        onBack={onBack}
        action={
          activeTab === "clubs"
            ? {
                label: t("clubs.addClub"),
                onClick: openAddModal,
                icon: Plus,
              }
            : undefined
        }
      />

      {/* Tabs toggle */}
      <div className="flex gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab("clubs")}
          data-elevation="control"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
            activeTab === "clubs"
              ? "bg-primary/80 text-primary-foreground font-semibold"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          {t("admin.clubsList") || "Clubs List"}
        </button>
        <button
          onClick={() => setActiveTab("claims")}
          data-elevation="control"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer relative ${
            activeTab === "claims"
              ? "bg-primary/80 text-primary-foreground font-semibold"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          {t("admin.pendingClaims") || "Pending Claims"}
          {pendingClaims.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-foreground/30 text-primary-foreground rounded-full font-bold">
              {pendingClaims.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "clubs" ? (
        <>
          {/* Search and Filters */}
          <div className="flex gap-3">
            <AdminSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t("clubs.searchPlaceholder")}
            />
            <Select
              value={selectedClubType || ALL_CLUB_TYPES_VALUE}
              onValueChange={(value) =>
                setSelectedClubType(value === ALL_CLUB_TYPES_VALUE ? "" : value)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("admin.allTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CLUB_TYPES_VALUE}>
                  {t("admin.allTypes")}
                </SelectItem>
                {visibleClubTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AdminResultsCount
            count={filteredOrganizations.length}
            singularLabel={t("admin.club")}
            pluralLabel={t("navigation.clubs")}
          />

          {/* Clubs Table */}
          {isLoading ? (
            <LoadingPage />
          ) : filteredOrganizations.length > 0 ? (
            <AdminTable
              headers={[
                { label: t("forms.clubName") },
                { label: t("forms.categories") },
                { label: t("forms.clubType") },
                { label: t("forms.ownerEmail") || "Owner Email" },
                { label: <span className="flex items-center gap-1.5"><Instagram className="size-3.5" />{t("admin.instagram")}</span> },
                { label: <span className="flex items-center gap-1.5"><MessageCircle className="size-3.5" />{t("admin.discord")}</span> },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {paginatedClubs.map((club) => (
                <TableRow key={club.id}>
                  <TableCell>
                    <div className="font-medium text-sm text-foreground">
                      {club.club_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {club.categories.slice(0, 2).map((cat) => (
                        <span
                          key={cat}
                          className="text-xs px-2 py-0.5 bg-secondary rounded-full text-muted-foreground"
                        >
                          {cat}
                        </span>
                      ))}
                      {club.categories.length > 2 && (
                        <span className="text-xs text-muted-foreground">
                          +{club.categories.length - 2}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {club.club_type}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[140px] truncate text-xs text-muted-foreground">
                      {club.owner_email || club.created_by || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {club.ig ? (
                      <span className="text-sm text-muted-foreground">@{club.ig}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {club.discord ? (
                      <span className="max-w-[100px] truncate text-sm text-muted-foreground">{club.discord}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditModal(club)}
                      >
                        {t("common.edit") || "Edit"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDeleteConfirmId(club.id)}
                        className="hover:bg-error/10 hover:text-error"
                      >
                        {t("common.delete") || "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </AdminTable>
          ) : (
            <AdminEmptyState
              icon={Users}
              title={t("admin.noClubsFound")}
              description={t("admin.noClubsMatchFilters")}
            />
          )}

          {filteredOrganizations.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredOrganizations.length}
              itemsPerPage={ITEMS_PER_PAGE}
              itemLabel={t("admin.club")}
              itemLabelPlural={t("navigation.clubs")}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      ) : (
        <>
          {/* Pending Claims Section */}
          <AdminResultsCount
            count={pendingClaims.length}
            singularLabel={t("admin.pendingClaim") || "pending claim"}
            pluralLabel={t("admin.pendingClaims") || "pending claims"}
          />

          {loadingClaims ? (
            <LoadingPage />
          ) : pendingClaims.length > 0 ? (
            <AdminTable
              headers={[
                { label: t("forms.clubName") || "Club Name" },
                { label: t("admin.requestedBy") || "Requested By" },
                { label: t("admin.executiveRole") || "Executive Role" },
                { label: <span className="flex items-center gap-1"><ExternalLink className="size-3" />{t("admin.proofUrl") || "Proof URL"}</span> },
                { label: t("admin.submittedAt") || "Submitted" },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {pendingClaims.map((claim) => (
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
                        <span>{t("admin.viewProof") || "View Proof"}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("admin.noProofProvided") || "No proof provided"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {new Date(claim.created_at).toLocaleDateString()}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleApproveClaim(claim.id)}
                        className="text-primary hover:bg-primary/10 border border-transparent"
                      >
                        {t("admin.approve") || "Approve"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRejectClaimId(claim.id)}
                        className="text-error hover:bg-error/10 border border-transparent"
                      >
                        {t("admin.reject") || "Reject"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </AdminTable>
          ) : (
            <AdminEmptyState
              icon={ShieldAlert}
              title={t("admin.noPendingClaimsTitle") || "All caught up!"}
              description={t("admin.noPendingClaimsDesc") || "There are no pending club claims to review right now."}
            />
          )}
        </>
      )}

      <AdminDeleteDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId != null && handleDelete(deleteConfirmId)}
        title={t("admin.deleteClub")}
        description={t("admin.deleteClubConfirm")}
        isLoading={isDeleting}
      />

      <AddOrganizationModal
        isOpen={showAddModal}
        onClose={closeModal}
        onSave={handleSave}
        initialData={editingClub || undefined}
      />

      {/* Reject Claim Dialog */}
      <Dialog open={rejectClaimId !== null} onOpenChange={(open) => !open && setRejectClaimId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.rejectOrganizationClaim") || "Reject Club Claim"}</DialogTitle>
            <DialogDescription>
              {t("admin.rejectClaimDescription") || "Please provide a reason why this claim is being rejected. This will help the user fix their request."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Textarea
              placeholder={t("admin.rejectionPlaceholder") || "e.g. Invalid proof URL or role cannot be verified."}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRejectClaimId(null)} disabled={submittingResolution}>
              {t("common.cancel") || "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectClaim}
              disabled={submittingResolution || !rejectionReason.trim()}
            >
              {t("admin.rejectRequest") || "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
