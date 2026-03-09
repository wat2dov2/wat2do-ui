/**
 * Reject Submission Dialog Component
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

interface RejectSubmissionDialogProps {
  isOpen: boolean;
  rejectionReason: string;
  onClose: () => void;
  onConfirm: () => void;
  onRejectionReasonChange: (reason: string) => void;
}

export function RejectSubmissionDialog({
  isOpen,
  rejectionReason,
  onClose,
  onConfirm,
  onRejectionReasonChange,
}: RejectSubmissionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.rejectEventSubmission")}</DialogTitle>
          <DialogDescription>
            {t("admin.rejectSubmissionDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              {t("admin.rejectionReason")} <span className="text-error">*</span>
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => onRejectionReasonChange(e.target.value)}
              placeholder={t("admin.enterRejectionReason")}
              className="w-full min-h-[100px] px-3 py-2 text-sm border border-border bg-muted text-foreground rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              required
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={!rejectionReason.trim()}
            >
              {t("admin.confirmRejection")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
