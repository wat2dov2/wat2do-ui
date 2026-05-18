import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
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
import { showToast } from "@/shared/ui/toast";
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
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason("");
      setIsSubmitting(false);
      setIsSubmitted(false);
    }
  }, [open]);

  const trimmedReason = reason.trim();

  async function handleSubmit() {
    if (!trimmedReason) return;
    setIsSubmitting(true);
    try {
      await reportEventToBackend(eventId, trimmedReason);
      showToast("Report submitted", "success");
      setIsSubmitted(true);
    } catch (err) {
      console.error("Failed to report event:", err);
      showToast("Couldn't submit report", "error");
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
              <DialogTitle>Report submitted</DialogTitle>
              <DialogDescription>
                Thanks for flagging "{eventTitle}". We'll review it soon.
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-end">
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report event</DialogTitle>
              <DialogDescription>
                Tell us why you want to report "{eventTitle}".
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Share the reason for this report"
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
                Cancel
              </Button>
              <LoadingButton
                type="button"
                onClick={handleSubmit}
                disabled={!trimmedReason}
                isLoading={isSubmitting}
                loadingText="Submitting..."
              >
                Submit report
              </LoadingButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
