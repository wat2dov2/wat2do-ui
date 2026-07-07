import { useState } from "react";
import { CheckCircle2 } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
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
        title: t("events.reportDialog.submittedTitle"),
        description: t("events.reportDialog.submittedDescription", { title: eventTitle }),
        variant: "success",
      });
      setIsSubmitted(true);
    } catch (err) {
      console.error("Failed to report event:", err);
      toast({
        title: t("events.reportDialog.submitFailed"),
        description: t("events.reportDialog.submitFailed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DrawerContent className="overflow-hidden p-0">
        <div className="mx-auto w-full max-w-md space-y-4 px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          {isSubmitted ? (
            <>
              <DrawerHeader className="items-start p-0 text-left">
                <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CheckCircle2 className="size-5" />
                </div>
                <DrawerTitle>{t("events.reportDialog.submittedTitle")}</DrawerTitle>
                <DrawerDescription>
                  {t("events.reportDialog.submittedDescription", { title: eventTitle })}
                </DrawerDescription>
              </DrawerHeader>

              <div className="flex justify-end">
                <Button type="button" onMouseDown={() => onOpenChange(false)}>
                  {t("common.done")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DrawerHeader className="p-0 text-left">
                <DrawerTitle>{t("events.reportDialog.title")}</DrawerTitle>
                <DrawerDescription>
                  {t("events.reportDialog.description", { title: eventTitle })}
                </DrawerDescription>
              </DrawerHeader>

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
                  onMouseDown={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  {t("common.cancel")}
                </Button>
                <LoadingButton
                  type="button"
                  onMouseDown={handleSubmit}
                  disabled={!trimmedReason}
                  isLoading={isSubmitting}
                  loadingText={t("common.submitting")}
                >
                  {t("events.reportDialog.submit")}
                </LoadingButton>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
