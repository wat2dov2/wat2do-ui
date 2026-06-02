import { useMemo } from "react";
import { Check, Sparkles, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { toast } from "@/shared/hooks/use-toast";

interface EventSuccessScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
}

export function EventSuccessScreen({
  isOpen,
  onClose,
  onPromote,
  isEditMode,
  isSubmissionOnly,
}: EventSuccessScreenProps) {
  const { t } = useTranslation();
  const { formData } = useEventFormContext();
  const successEvent = useMemo(
    () => ({
      occurrences: formData.occurrences.map((o) => ({
        dtstart_utc: o.dtstart_local,
        dtend_utc: o.dtend_local || null,
      })),
    }),
    [formData.occurrences],
  );

  const handleDone = () => {
    onClose();
    setTimeout(() => {
      toast({
        title: isSubmissionOnly
          ? t("events.submissionReceived")
          : isEditMode
            ? t("events.eventUpdated")
            : t("events.eventCreated"),
        description: isEditMode
          ? t("events.eventUpdatedMessage", { title: formData.title })
          : isSubmissionOnly
            ? t("events.submissionReceivedMessage", { title: formData.title })
            : t("events.eventCreatedMessage", { title: formData.title }),
        variant: "success",
      });
    }, SCROLL_INTO_VIEW_DELAY_MS);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">
          {isSubmissionOnly
            ? t("events.submissionReceivedTitle")
            : isEditMode
              ? t("events.eventUpdatedTitle")
              : t("events.eventCreatedTitle")}
        </DialogTitle>
        <div className="flex flex-col items-center text-center py-4 gap-y-4">
          <div className="relative">
            <div className="size-16 rounded-full bg-success flex items-center justify-center">
              <Check className="size-8 text-white" strokeWidth={3} />
            </div>
            <div className="absolute -top-1 -right-1 size-6 bg-warning rounded-full flex items-center justify-center">
              <Sparkles className="size-3 text-white" />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-foreground">
            {isSubmissionOnly
              ? t("events.submissionReceived")
              : isEditMode
                ? t("events.eventUpdated")
                : t("events.eventCreated")}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}"{" "}
            {isSubmissionOnly
              ? t("events.submissionReceivedDesc")
              : isEditMode
                ? t("events.eventUpdatedDesc")
                : t("events.eventCreatedDesc")}
          </p>

          <div className="w-full rounded-lg p-4 text-left bg-secondary space-y-1">
            <p className="font-medium text-foreground">{formData.title}</p>
            <p className="text-sm text-muted-foreground">
              {formData.organization}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatCardDate(successEvent)}
              {" "}
              {t("common.at")}
              {" "}
              {formatCardTime(successEvent)}
            </p>
          </div>

          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={handleDone} className="flex-1">
              {t("common.done")}
            </Button>
            {onPromote && (
              <Button
                onClick={onPromote}
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                <Megaphone className="size-4 mr-1.5" />
                {t("events.promote")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
