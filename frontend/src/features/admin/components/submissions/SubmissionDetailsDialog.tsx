/**
 * Submission Details Dialog Component
 * Extracted from AdminSubmissionsPage to reduce complexity
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import type { EventSubmission } from "@/shared/types";

interface SubmissionDetailsDialogProps {
  submission: EventSubmission | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (submission: EventSubmission) => void;
  onRejectClick: (submission: EventSubmission) => void;
  formatRelativeTime: (dateStr: string) => string;
}

export function SubmissionDetailsDialog({
  submission,
  isOpen,
  onClose,
  onApprove,
  onRejectClick,
  formatRelativeTime,
}: SubmissionDetailsDialogProps) {
  const { t } = useTranslation();

  if (!submission) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.submissionDetails")}</DialogTitle>
          <DialogDescription>
            {t("admin.reviewSubmissionDetails")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <DetailRow label={t("events.eventTitle")} value={submission.eventData.title} />
          <DetailRow label={t("events.organization")} value={submission.eventData.organization} />
          <DetailRow
            label={t("events.description")}
            value={submission.eventData.description || t("common.noDescription")}
          />
          <div className="grid grid-cols-2 gap-4">
            <DetailRow label={t("filters.date")} value={submission.eventData.date} />
            <DetailRow label={t("filters.time")} value={submission.eventData.time} />
          </div>
          <DetailRow label={t("filters.location")} value={submission.eventData.location} />
          <DetailRow
            label={t("filters.category")}
            value={submission.eventData.category || t("common.none")}
          />
          <DetailRow label={t("events.price")} value={`$${submission.eventData.price}`} />

          {submission.eventData.food.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                {t("events.foodProvided")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {submission.eventData.food.map((food) => (
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

          <DetailRow
            label={t("events.requiresRegistration")}
            value={submission.eventData.requiresRegistration ? t("common.yes") : t("common.no")}
          />

          <div className="border-t border-border pt-4">
            <DetailRow label={t("admin.submittedBy")} value={submission.submittedBy} />
            <p className="text-xs text-muted-foreground mt-1">
              {formatRelativeTime(submission.submittedAt)}
            </p>
          </div>

          {submission.status === "pending" && (
            <div className="flex gap-2 justify-end pt-4 border-t border-border">
              <Button variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onRejectClick(submission)}
                className="text-error hover:text-error hover:bg-error/10"
              >
                {t("admin.reject")}
              </Button>
              <Button onClick={() => onApprove(submission)}>
                {t("admin.approve")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h3 className="font-semibold text-sm text-gray-900 mb-1">{label}</h3>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
