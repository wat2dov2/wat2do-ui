import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/shared/ui/drawer";
import { DrawerBody, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";
import type { EventSubmission } from "@/shared/types";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateFood } from "@/shared/utils/foodTranslation";

interface SubmissionDetailsDrawerProps {
  submission: EventSubmission | null;
  clubName: string;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (submission: EventSubmission) => void | Promise<void>;
  onRejectClick: (submission: EventSubmission) => void;
  formatRelativeTime: (dateStr: string) => string;
  isApproving?: boolean;
}

export function SubmissionDetailsDrawer({
  submission,
  clubName,
  isOpen,
  onClose,
  onApprove,
  onRejectClick,
  formatRelativeTime,
  isApproving = false,
}: SubmissionDetailsDrawerProps) {
  const { t } = useTranslation();

  if (!submission) return null;

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("admin.submissionDetails")}</DrawerTitle>
          <DrawerDescription>
            {t("admin.reviewSubmissionDetails")}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody>
          <DetailRow label={t("events.eventTitle")} value={submission.eventData.title} />
          <DetailRow label={t("events.club")} value={clubName} />
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

        </DrawerBody>
        {submission.status === SUBMISSION_PENDING && (
          <DrawerFooter>
            <Stack direction="horizontal" gap={2} justify="end">
              <Button
                variant="outline"
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
            </Stack>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
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
