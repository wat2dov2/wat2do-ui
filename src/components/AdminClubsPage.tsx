import React, { useState, useMemo, useEffect } from "react";
import { Search, Edit, Trash2, Users, Tag, X, ArrowLeft, Plus, Instagram, MessageCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { mockClubs } from "@/data/clubs";
import type { Club } from "@/types";
import { AddClubModal } from "./AddClubModal";

interface AdminClubsPageProps {
  onBack: () => void;
  onAddClub?: (club: Club) => void;
  onEditClub?: (club: Club) => void;
  onDeleteClub?: (clubId: number) => void;
}

export function AdminClubsPage({
  onBack,
  onAddClub,
  onEditClub,
  onDeleteClub,
}: AdminClubsPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClubType, setSelectedClubType] = useState<string>("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  // Get unique club types
  const clubTypes = useMemo(() => {
    const types = new Set<string>();
    mockClubs.forEach((club) => types.add(club.club_type));
    return Array.from(types).sort();
  }, []);

  // Filter clubs
  const filteredClubs = useMemo(() => {
    return mockClubs.filter((club) => {
      if (
        searchQuery &&
        !club.club_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;

      if (selectedClubType && club.club_type !== selectedClubType) return false;

      return true;
    });
  }, [searchQuery, selectedClubType]);

  // Pagination
  const totalPages = Math.ceil(filteredClubs.length / ITEMS_PER_PAGE);
  const paginatedClubs = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredClubs.slice(startIndex, endIndex);
  }, [filteredClubs, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClubType]);

  const handleDelete = (clubId: number) => {
    if (onDeleteClub) {
      onDeleteClub(clubId);
    }
    setDeleteConfirmId(null);
  };

  const handleEdit = (club: Club) => {
    setEditingClub(club);
    setShowAddModal(true);
  };

  const handleAdd = () => {
    setEditingClub(null);
    setShowAddModal(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Clubs</h1>
            <p className="text-sm text-muted-foreground">
              View, edit, and delete student clubs
            </p>
          </div>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-2" />
          Add Club
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            type="text"
            placeholder="Search clubs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select
          value={selectedClubType || undefined}
          onValueChange={(value) => setSelectedClubType(value || "")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Club Types" />
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

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredClubs.length}{" "}
          {filteredClubs.length === 1 ? "club" : "clubs"}
        </span>
      </div>

      {/* Clubs Table */}
      {filteredClubs.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead className="text-xs font-semibold text-gray-900">
                  Club Name
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Categories
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Club Type
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Instagram
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Discord
                </TableHead>
                <TableHead className="text-right text-xs font-semibold text-gray-900">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedClubs.map((club) => (
                <TableRow key={club.id}>
                  <TableCell>
                    <div className="font-medium text-sm text-gray-900">
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
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEdit(club)}
                        title="Edit club"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteConfirmId(club.id)}
                        title="Delete club"
                        className="hover:bg-error/10 hover:text-error"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Pagination */}
      {filteredClubs.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredClubs.length)} of{" "}
            {filteredClubs.length} clubs
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="w-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {filteredClubs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No clubs found
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No clubs match your current filters.
          </p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Club</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this club? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirmId && handleDelete(deleteConfirmId)
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Club Modal */}
      <AddClubModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingClub(null);
        }}
        onSave={(club) => {
          if (editingClub && onEditClub) {
            onEditClub(club);
          } else if (onAddClub) {
            onAddClub(club);
          }
          setShowAddModal(false);
          setEditingClub(null);
        }}
        initialData={editingClub || undefined}
      />
    </div>
  );
}
