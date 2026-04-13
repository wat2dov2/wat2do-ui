import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Edit, Trash2, Plus, Instagram, MessageCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/shared/ui/table";
import type { Club } from "@/shared/types";
import { AddClubModal } from "@/features/clubs";
import { useAdminClubsPage } from "@/features/admin/hooks/useAdminClubsPage";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminSearchBar } from "@/features/admin/components/shared/AdminSearchBar";
import { AdminResultsCount } from "@/features/admin/components/shared/AdminResultsCount";
import { AdminPagination } from "@/features/admin/components/shared/AdminPagination";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminDeleteDialog } from "@/features/admin/components/shared/AdminDeleteDialog";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { LoadingPage } from "@/shared/ui/loading-page";
import { useAdminContext } from "@/features/admin/context/AdminContext";
import { ADMIN_ITEMS_PER_PAGE } from "@/shared/constants/pagination";

const ITEMS_PER_PAGE = ADMIN_ITEMS_PER_PAGE;

export function AdminClubsPage() {
  const { onBack, onAddClub, onEditClub, onDeleteClub } = useAdminContext();
  const { t } = useTranslation();
  const {
    searchQuery,
    selectedClubType,
    deleteConfirmId,
    showAddModal,
    editingClub,
    currentPage,
    clubTypes,
    filteredClubs,
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
  } = useAdminClubsPage({ itemsPerPage: ITEMS_PER_PAGE });

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (clubId: number) => {
    setIsDeleting(true);
    try {
      if (onDeleteClub) {
        await onDeleteClub(clubId);
      }
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
        if (onEditClub) {
          await onEditClub(club);
        }
      } else {
        if (onAddClub) {
          await onAddClub(club);
        }
      }
      await refreshClubs();
      closeModal();
    } catch (error) {
      console.error("Failed to save club:", error);
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Users}
        title={t("admin.manageClubs")}
        description={t("admin.manageClubsDesc")}
        onBack={onBack}
        action={{
          label: t("clubs.addClub"),
          onClick: openAddModal,
          icon: Plus,
        }}
      />

      {/* Search and Filters */}
      <div className="flex gap-3">
        <AdminSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("clubs.searchPlaceholder")}
        />
        <Select
          value={selectedClubType || undefined}
          onValueChange={(value) => setSelectedClubType(value || "")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("admin.allTypes")} />
          </SelectTrigger>
          <SelectContent>
            {clubTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AdminResultsCount
        count={filteredClubs.length}
        singularLabel={t("admin.club")}
        pluralLabel={t("navigation.clubs")}
      />

      {/* Clubs Table */}
      {isLoading ? (
        <LoadingPage />
      ) : filteredClubs.length > 0 ? (
        <AdminTable
          headers={[
            { label: t("forms.clubName") },
            { label: t("forms.categories") },
            { label: t("forms.clubType") },
            { label: t("admin.instagram") },
            { label: t("admin.discord") },
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
                      className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground"
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
                {club.ig ? (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Instagram className="w-3.5 h-3.5" />
                    <span>@{club.ig}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {club.discord ? (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span className="max-w-[100px] truncate">{club.discord}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => openEditModal(club)}
                    title={t("admin.editClub")}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => setDeleteConfirmId(club.id)}
                    title={t("admin.deleteClub")}
                    className="hover:bg-error/10 hover:text-error"
                  >
                    <Trash2 className="w-4 h-4" />
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

      {filteredClubs.length > 0 && (
        <AdminPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredClubs.length}
          itemsPerPage={ITEMS_PER_PAGE}
          itemLabel={t("admin.club")}
          itemLabelPlural={t("navigation.clubs")}
          onPageChange={setCurrentPage}
        />
      )}

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
    </div>
  );
}
