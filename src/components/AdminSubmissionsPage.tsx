import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Check, X as XIcon, ArrowLeft, FileText, Clock, User, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  getEventSubmissions,
  updateEventSubmission,
} from "@/data/adminData";
import type { EventSubmission } from "@/types";

interface AdminSubmissionsPageProps {
  onBack: () => void;
  onApprove?: (submission: EventSubmission) => void;
}

export function AdminSubmissionsPage({
  onBack,
  onApprove,
}: AdminSubmissionsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [rejectSubmissionId, setRejectSubmissionId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  // Get submissionId from URL
  const submissionIdParam = searchParams.get("submissionId");
  const selectedSubmission = useMemo(() => {
    if (submissionIdParam) {
      const allSubmissions = getEventSubmissions();
      return allSubmissions.find((s) => s.id === submissionIdParam) || null;
    }
    return null;
  }, [submissionIdParam, refreshKey]);

  // Check URL parameters on mount for highlighting
  useEffect(() => {
    if (submissionIdParam) {
      // Scroll to the submission after a short delay
      setTimeout(() => {
        const element = document.getElementById(`submission-${submissionIdParam}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    }
  }, [submissionIdParam]);

  // Get all submissions
  const allSubmissions = useMemo(() => {
    return getEventSubmissions();
  }, [refreshKey]);

  // Filter submissions
  const filteredSubmissions = useMemo(() => {
    let filtered = allSubmissions;

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(
        (s) =>
          s.eventData.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.eventData.organization.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.submittedBy.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort by submittedAt (newest first)
    return filtered.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [allSubmissions, statusFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredSubmissions.length / ITEMS_PER_PAGE);
  const paginatedSubmissions = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredSubmissions.slice(startIndex, endIndex);
  }, [filteredSubmissions, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const handleApprove = (submission: EventSubmission) => {
    updateEventSubmission(submission.id, "approved");
    if (onApprove) {
      onApprove(submission);
    }
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("submissionId");
    setSearchParams(newParams);
  };

  const handleRejectClick = (submission: EventSubmission) => {
    setRejectSubmissionId(submission.id);
    setRejectionReason("");
  };

  const handleRejectConfirm = () => {
    if (rejectSubmissionId && rejectionReason.trim()) {
      updateEventSubmission(rejectSubmissionId, "rejected", rejectionReason.trim());
      setRejectSubmissionId(null);
      setRejectionReason("");
      setRefreshKey((prev) => prev + 1);
      // Close modal if the rejected submission was open
      if (submissionIdParam === rejectSubmissionId) {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete("submissionId");
        setSearchParams(newParams);
      }
    }
  };


  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <FileText className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Submissions</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve event submissions
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            type="text"
            placeholder="Search submissions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(
              value as "all" | "pending" | "approved" | "rejected"
            )
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredSubmissions.length}{" "}
          {filteredSubmissions.length === 1 ? "submission" : "submissions"}
        </span>
      </div>

      {/* Submissions Table */}
      {filteredSubmissions.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead className="text-xs font-semibold text-gray-900">
                  Title
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Organization
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Submitted By
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Submitted At
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  Status
                </TableHead>
                <TableHead className="text-right text-xs font-semibold text-gray-900">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSubmissions.map((submission) => {
                const isHighlighted = submissionIdParam === submission.id;
                return (
                  <TableRow
                    key={submission.id}
                    id={`submission-${submission.id}`}
                    className={`cursor-pointer hover:bg-muted/50 ${submissionIdParam === submission.id ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("submissionId", submission.id);
                      setSearchParams(newParams);
                    }}
                  >
                    <TableCell>
                      <div className="font-medium text-sm text-gray-900">
                        {submission.eventData.title}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {submission.eventData.organization}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <User className="w-3.5 h-3.5" />
                        <span>{submission.submittedBy}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatRelativeTime(submission.submittedAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          submission.status === "approved"
                            ? "bg-success/20 text-success"
                            : submission.status === "rejected"
                            ? "bg-error/20 text-error"
                            : "bg-warning/20 text-warning"
                        }`}
                      >
                        {submission.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {submission.status === "pending" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApprove(submission);
                              }}
                              className="text-success hover:text-success hover:bg-success/10"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRejectClick(submission);
                              }}
                              className="text-error hover:text-error hover:bg-error/10"
                            >
                              <XIcon className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Pagination */}
      {filteredSubmissions.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredSubmissions.length)} of{" "}
            {filteredSubmissions.length} submissions
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

      {filteredSubmissions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No submissions found
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No submissions match your current filters.
          </p>
        </div>
      )}

      {/* Submission Details Dialog */}
      <Dialog
        open={selectedSubmission !== null}
        onOpenChange={(open) => {
          if (!open) {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete("submissionId");
            setSearchParams(newParams);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Details</DialogTitle>
            <DialogDescription>
              Review the event submission details
            </DialogDescription>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Title
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.title}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Organization
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.organization}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Description
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.description || "No description"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">
                    Date
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSubmission.eventData.date}
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">
                    Time
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSubmission.eventData.time}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Location
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.location}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Category
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.category || "None"}
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Price
                </h3>
                <p className="text-sm text-muted-foreground">
                  ${selectedSubmission.eventData.price}
                </p>
              </div>

              {selectedSubmission.eventData.food.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">
                    Food Provided
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSubmission.eventData.food.map((food) => (
                      <span
                        key={food}
                        className="text-xs px-2 py-1 bg-warning/20 text-warning rounded-full"
                      >
                        {food}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Requires Registration
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.eventData.requiresRegistration
                    ? "Yes"
                    : "No"}
                </p>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  Submitted By
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selectedSubmission.submittedBy}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatRelativeTime(selectedSubmission.submittedAt)}
                </p>
              </div>

              {selectedSubmission.status === "pending" && (
                <div className="flex gap-2 justify-end pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.delete("submissionId");
                      setSearchParams(newParams);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleRejectClick(selectedSubmission)}
                    className="text-error hover:text-error hover:bg-error/10"
                  >
                    Reject
                  </Button>
                  <Button onClick={() => handleApprove(selectedSubmission)}>
                    Approve
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Reject Confirmation Dialog */}
      <Dialog
        open={rejectSubmissionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectSubmissionId(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Event Submission</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this event submission. This will help the submitter understand why their submission was not approved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Rejection Reason <span className="text-error">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter the reason for rejection..."
                className="w-full min-h-[100px] px-3 py-2 text-sm border border-border bg-muted text-foreground rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                required
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRejectSubmissionId(null);
                  setRejectionReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectConfirm}
                disabled={!rejectionReason.trim()}
              >
                Confirm Rejection
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
