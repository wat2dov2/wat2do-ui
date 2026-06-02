import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
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
import { Textarea } from "@/shared/ui/textarea";
import { toast } from "@/shared/hooks/use-toast";
import { reportEventToBackend } from "@/features/events/api/events.api";

interface EventReportDialogProps {
  eventId: number;
  eventTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventReportDialog({
  eventId,
  eventTitle,
  open,
  onOpenChange,
}: EventReportDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const trimmedReason = reason.trim();

  async function handleSubmit() {
    if (!trimmedReason) return;
    setIsSubmitting(true);
    try {
      await reportEventToBackend(eventId, trimmedReason);
      toast({
        title: "Report Submitted",
        description: t("events.reportDialog.submittedTitle"),
        variant: "success",
      });
      setIsSubmitted(true);
    } catch (err) {
      console.error("Failed to report event:", err);
      toast({
        title: "Submission Failed",
        description: t("events.reportDialog.submitFailed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-md">
        {isSubmitted ? (
          <>
            <DialogHeader>
              <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckCircle2 className="size-5" />
              </div>
              <DialogTitle>{t("events.reportDialog.submittedTitle")}</DialogTitle>
              <DialogDescription>
                {t("events.reportDialog.submittedDescription", { title: eventTitle })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-end">
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("common.done")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("events.reportDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("events.reportDialog.description", { title: eventTitle })}
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("events.reportDialog.placeholder")}
              maxLength={500}
              className="min-h-28"
              disabled={isSubmitting}
              autoFocus
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <LoadingButton
                type="button"
                onClick={handleSubmit}
                disabled={!trimmedReason}
                isLoading={isSubmitting}
                loadingText={t("common.submitting")}
              >
                {t("events.reportDialog.submit")}
              </LoadingButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
