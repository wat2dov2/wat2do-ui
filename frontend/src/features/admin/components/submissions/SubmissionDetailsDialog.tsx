import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import type { EventSubmission } from "@/shared/types";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateFood } from "@/shared/utils/foodTranslation";

interface SubmissionDetailsDialogProps {
  submission: EventSubmission | null;
  organizationName: string;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (submission: EventSubmission) => void | Promise<void>;
  onRejectClick: (submission: EventSubmission) => void;
  formatRelativeTime: (dateStr: string) => string;
  isApproving?: boolean;
}

export function SubmissionDetailsDialog({
  submission,
  organizationName,
  isOpen,
  onClose,
  onApprove,
  onRejectClick,
  formatRelativeTime,
  isApproving = false,
}: SubmissionDetailsDialogProps) {
  const { t } = useTranslation();

  if (!submission) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{t("admin.submissionDetails")}</DialogTitle>
          <DialogDescription>
            {t("admin.reviewSubmissionDetails")}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-6 pt-2 space-y-4">
          <DetailRow label={t("events.eventTitle")} value={submission.eventData.title} />
          <DetailRow label={t("events.organization")} value={organizationName} />
          <DetailRow
            label={t("forms.description")}
            value={submission.eventData.description || t("common.noDescription")}
          />
          <div>
            <h3 className="font-semibold text-sm text-foreground mb-1">
              {t("forms.occurrences")}
            </h3>
            <div className="space-y-1">
              {submission.eventData.occurrences.map((occurrence) => (
                <p
                  key={occurrence.dtstart_local}
                  className="text-sm text-muted-foreground"
                >
                  {formatCardDate({ occurrences: [{ dtstart_utc: occurrence.dtstart_local, dtend_utc: occurrence.dtend_local }] })}{" "}
                  {formatCardTime({ occurrences: [{ dtstart_utc: occurrence.dtstart_local, dtend_utc: occurrence.dtend_local }] })}
                </p>
              ))}
            </div>
          </div>
          <DetailRow label={t("filters.location")} value={submission.eventData.location} />
          <DetailRow
            label={t("filters.category")}
            value={submission.eventData.category || t("common.none")}
          />
          <DetailRow label={t("filters.price")} value={`$${submission.eventData.price}`} />

          {submission.eventData.food.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-foreground mb-1">
                {t("forms.foodProvided")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {submission.eventData.food.map((food) => (
                  <span
                    key={food}
                    className="text-xs px-2 py-1 bg-warning/20 text-warning rounded-full"
                  >
                    {translateFood(food, t)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <DetailRow
            label={t("filters.registration")}
            value={submission.eventData.registration ? t("common.yes") : t("common.no")}
          />

          <div className="border-t border-border pt-4">
            <DetailRow label={t("admin.submittedBy")} value={submission.submittedBy} />
            <p className="text-xs text-muted-foreground mt-1">
              {formatRelativeTime(submission.submittedAt)}
            </p>
          </div>

          {submission.status === SUBMISSION_PENDING && (
            <div className="flex gap-2 justify-end pt-4 border-t border-border">
              <Button variant="secondary" onClick={onClose} disabled={isApproving}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => onRejectClick(submission)}
                className="text-destructive hover:text-destructive hover:bg-surface-hover"
                disabled={isApproving}
              >
                {t("admin.reject")}
              </Button>
              <LoadingButton
                onClick={() => onApprove(submission)}
                isLoading={isApproving}
                loadingText={t("common.pleaseWait")}
              >
                {t("admin.approve")}
              </LoadingButton>
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
      <h3 className="font-semibold text-sm text-foreground mb-1">{label}</h3>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
