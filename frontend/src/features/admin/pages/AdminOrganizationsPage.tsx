import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Plus, ExternalLink, ShieldAlert } from "@/shared/ui/doodle-icons";
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
import type { Organization, SubmissionStatus } from "@/shared/types";
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
import { usePagination } from "@/shared/hooks";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { OrganizationCategoryBadges } from "@/features/organizations/components/OrganizationCategoryBadges";
import { useEventsStore } from "@/features/events";

const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;
const ALL_ORGANIZATION_TYPES_VALUE = "__all_organization_types__";

interface AdminOrganizationsPageProps {
  onBack: () => void;
}

export function AdminOrganizationsPage({
  onBack,
}: AdminOrganizationsPageProps) {
  const { t } = useTranslation();
  const {
    searchQuery,
    selectedOrganizationType,
    deleteConfirmId,
    showAddModal,
    editingOrganization,
    currentPage,
    organizationTypes,
    organizations,
    totalItems,
    totalPages,
    isLoading,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    setSelectedOrganizationType,
    setDeleteConfirmId,
    openAddModal,
    openEditModal,
    closeModal,
    setCurrentPage,
    refreshOrganizations,
  } = useAdminOrganizationsPage({ itemsPerPage: ITEMS_PER_PAGE });

  const [activeTab, setActiveTab] = useState<"organizations" | "claims">("organizations");

  const allClaims = useAdminStore((s) => s.claims);
  const fetchClaims = useAdminStore((s) => s.fetchClaims);
  const approveClaimAction = useAdminStore((s) => s.approveClaim);
  const rejectClaimAction = useAdminStore((s) => s.rejectClaim);

  const [loadingClaims, setLoadingClaims] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  const [claimSearchQuery, setClaimSearchQuery] = useState("");
  const [claimStatusFilter, setClaimStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const pendingClaimsCount = useMemo(() => {
    return allClaims.filter((c) => c.status === "pending").length;
  }, [allClaims]);

  const filteredClaims = useMemo(() => {
    let filtered = allClaims;

    if (claimStatusFilter !== "all") {
      filtered = filtered.filter((c) => c.status === claimStatusFilter);
    }

    if (claimSearchQuery) {
      const q = claimSearchQuery.toLowerCase();
      filtered = filtered.filter((c) => {
        const orgName = c.organizations?.organization_name || "";
        const userName = c.users?.full_name || "";
        const userEmail = c.users?.email || "";
        const role = c.executive_role || "";
        return (
          orgName.toLowerCase().includes(q) ||
          userName.toLowerCase().includes(q) ||
          userEmail.toLowerCase().includes(q) ||
          role.toLowerCase().includes(q)
        );
      });
    }

    return filtered;
  }, [allClaims, claimStatusFilter, claimSearchQuery]);

  const claimsPagination = usePagination({
    items: filteredClaims,
    itemsPerPage: ITEMS_PER_PAGE,
  });

  const [rejectClaimId, setRejectClaimId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submittingResolution, setSubmittingResolution] = useState(false);

  const visibleOrganizationTypes = organizationTypes.filter((type) => type.trim().length > 0);

  const loadClaimsData = useCallback(async () => {
    setLoadingClaims(true);
    try {
      await fetchClaims(schoolFilter ?? undefined);
    } catch (error) {
      console.error("Failed to load pending claims:", error);
    } finally {
      setLoadingClaims(false);
    }
  }, [fetchClaims, schoolFilter]);

  useEffect(() => {
    if (activeTab === "claims") {
      void loadClaimsData();
    }
  }, [activeTab, loadClaimsData]);

  const handleDelete = async (organizationId: number) => {
    setIsDeleting(true);
    try {
      await adminDeleteOrganization(organizationId);
      await refreshOrganizations();
    } catch (error) {
      console.error("Failed to delete organization:", error);
    } finally {
      setDeleteConfirmId(null);
      setIsDeleting(false);
    }
  };

  const handleSave = async (organization: Organization) => {
    try {
      if (editingOrganization) {
        await adminUpdateOrganization(organization);
      } else {
        await adminCreateOrganization(organization);
      }
      await refreshOrganizations();
      closeModal();
    } catch (error) {
      console.error("Failed to save organization:", error);
    }
  };

  const handleApproveClaim = async (claimId: string) => {
    try {
      await approveClaimAction(claimId);
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
      await rejectClaimAction(rejectClaimId, rejectionReason);
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
    <div className="space-y-5">
      <AdminPageHeader
        icon={Building2}
        title={t("admin.manageClubs")}
        description={t("admin.manageClubsDesc")}
        onBack={onBack}
        action={
          activeTab === "organizations"
            ? {
                label: t("organizations.addClub"),
                onClick: openAddModal,
                icon: Plus,
              }
            : undefined
        }
      />

      <div className="space-y-5 pb-2">
        <div className="flex gap-2 border-b border-border pb-3">
          <button
            onClick={() => setActiveTab("organizations")}
            data-elevation="control"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeTab === "organizations"
                ? "bg-primary/80 text-primary-foreground font-semibold"
                : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
            }`}
          >
            {t("admin.clubsList")}
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
            {t("admin.claimRequests")}
            {pendingClaimsCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-foreground/30 text-primary-foreground rounded-full font-bold">
                {pendingClaimsCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === "organizations" ? (
          <>
            <div className="flex gap-3">
              <AdminSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSubmit={submitSearchQuery}
                onClear={clearSearchQuery}
                placeholder={t("organizations.searchPlaceholder")}
                submitLabel={t("common.search")}
                clearLabel={t("organizations.clearSearch")}
              />
              <Select
                value={selectedOrganizationType || ALL_ORGANIZATION_TYPES_VALUE}
                onValueChange={(value) =>
                  setSelectedOrganizationType(value === ALL_ORGANIZATION_TYPES_VALUE ? "" : value)
                }
              >
                <SelectTrigger className="h-11 w-[180px]">
                  <SelectValue placeholder={t("admin.allTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ORGANIZATION_TYPES_VALUE}>
                    {t("admin.allTypes")}
                  </SelectItem>
                  {visibleOrganizationTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <AdminResultsCount
              count={totalItems}
              singularLabel={t("admin.club")}
              pluralLabel={t("navigation.organizations")}
            >
              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              )}
            </AdminResultsCount>
          </>
        ) : (
          <>
            <div className="flex gap-3">
              <AdminSearchBar
                value={claimSearchQuery}
                onChange={(value) => {
                  setClaimSearchQuery(value);
                  claimsPagination.setCurrentPage(1);
                }}
                placeholder={t("admin.searchSubmissions") || "Search requests..."}
              />
              <Select
                value={claimStatusFilter}
                onValueChange={(value) => {
                  setClaimStatusFilter(value as "all" | SubmissionStatus);
                  claimsPagination.setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-11 w-[180px]">
                  <SelectValue placeholder={t("admin.allStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.allStatus")}</SelectItem>
                  <SelectItem value="pending">{t("admin.pending")}</SelectItem>
                  <SelectItem value="approved">{t("admin.approved")}</SelectItem>
                  <SelectItem value="rejected">{t("admin.rejected")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <AdminResultsCount
              count={filteredClaims.length}
              singularLabel={t("admin.claimRequest") || "claim request"}
              pluralLabel={t("admin.claimRequests") || "claim requests"}
            >
              {claimsPagination.totalPages > 1 && (
                <Pagination
                  currentPage={claimsPagination.currentPage}
                  totalPages={claimsPagination.totalPages}
                  onPageChange={claimsPagination.setCurrentPage}
                />
              )}
            </AdminResultsCount>
          </>
        )}
      </div>

      {activeTab === "organizations" ? (
        <>
          {isLoading ? (
            <LoadingPage />
          ) : totalItems > 0 ? (
            <AdminTable
              headers={[
                { label: t("forms.organizationName") },
                { label: t("forms.categories") },
                { label: t("forms.organizationType") },
                { label: t("forms.ownerEmail") },
                { label: t("admin.instagram") },
                { label: t("admin.discord") },
                { label: t("common.actions"), align: "right" },
              ]}
            >
              {organizations.map((org) => (
                <TableRow
                  key={org.id}
                  className="cursor-pointer"
                  onClick={() => openEditModal(org)}
                >
                  <TableCell>
                    <div className="font-medium text-sm text-foreground">
                      {org.organization_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <OrganizationCategoryBadges
                      categories={org.categories}
                      maxVisible={2}
                      badgeClassName="h-5 text-[11px]"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {org.organization_type}
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
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(org);
                        }}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(org.id);
                        }}
                        className="hover:bg-error/10 hover:text-error"
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
          {loadingClaims ? (
            <LoadingPage />
          ) : filteredClaims.length > 0 ? (
            <>
              <AdminTable
                headers={[
                  { label: t("forms.organizationName") },
                  { label: t("admin.requestedBy") },
                  { label: t("admin.executiveRole") },
                  { label: <span className="flex items-center gap-1"><ExternalLink className="size-3" />{t("admin.proofUrl")}</span> },
                  { label: t("admin.submittedAt") || "Submitted At" },
                  { label: t("admin.status") || "Status" },
                  { label: t("common.actions"), align: "right" },
                ]}
              >
                {claimsPagination.paginatedItems.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell>
                      <div className="font-semibold text-sm text-foreground">
                        {claim.organizations?.organization_name || `Organization #${claim.organization_id}`}
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
                          <span>{t("admin.viewProof")}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("admin.noProofProvided")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {new Date(claim.created_at).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        <AdminStatusBadge status={claim.status as SubmissionStatus} />
                        {claim.status === "rejected" && claim.rejection_reason && (
                          <span className="text-[10px] text-error font-medium max-w-[150px] truncate" title={claim.rejection_reason}>
                            {t("admin.rejectionReason")}: {claim.rejection_reason}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {claim.status === "pending" && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleApproveClaim(claim.id)}
                              className="text-primary hover:bg-primary/10 border border-transparent"
                            >
                              {t("admin.approve")}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setRejectClaimId(claim.id)}
                              className="text-error hover:bg-error/10 border border-transparent"
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
              title={t("admin.noClaimsFound") || "No claim requests found"}
              description={t("admin.noClaimsMatchFilters") || "No claim requests match your current filters."}
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
        initialData={editingOrganization || undefined}
      />

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
