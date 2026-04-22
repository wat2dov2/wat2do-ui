/**
 * Submissions Table Component
 * Extracted from AdminSubmissionsPage to reduce complexity
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Check, X as XIcon, Clock, User } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import type { EventSubmission } from "@/shared/types";
import { QP } from "@/shared/constants/queryParams";

interface SubmissionsTableProps {
  submissions: EventSubmission[];
  onApprove: (submission: EventSubmission) => void;
  onRejectClick: (submission: EventSubmission) => void;
  formatRelativeTime: (dateStr: string) => string;
}

export function SubmissionsTable({
  submissions,
  onApprove,
  onRejectClick,
  formatRelativeTime,
}: SubmissionsTableProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const submissionIdParam = searchParams.get(QP.SUBMISSION_ID);

  const handleRowClick = (submissionId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set(QP.SUBMISSION_ID, submissionId);
    setSearchParams(newParams);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary">
            <TableHead className="text-xs font-semibold text-foreground">
              {t("events.eventTitle")}
            </TableHead>
            <TableHead className="text-xs font-semibold text-foreground">
              {t("events.organization")}
            </TableHead>
            <TableHead className="text-xs font-semibold text-foreground">
              {t("admin.submittedBy")}
            </TableHead>
            <TableHead className="text-xs font-semibold text-foreground">
              {t("admin.submittedAt")}
            </TableHead>
            <TableHead className="text-xs font-semibold text-foreground">
              {t("events.status")}
            </TableHead>
            <TableHead className="text-right text-xs font-semibold text-foreground">
              {t("common.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((submission) => {
            const isSelected = submissionIdParam === submission.id;
            return (
              <TableRow
                key={submission.id}
                id={`submission-${submission.id}`}
                className={`cursor-pointer hover:bg-secondary/50 ${isSelected ? "bg-primary/10" : ""}`}
                onClick={() => handleRowClick(submission.id)}
              >
                <TableCell>
                  <div className="font-medium text-sm text-foreground">
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
                  <AdminStatusBadge status={submission.status} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {submission.status === SUBMISSION_PENDING && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApprove(submission);
                          }}
                          className="text-success hover:text-success hover:bg-success/10"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRejectClick(submission);
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
  );
}
