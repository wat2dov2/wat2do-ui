import { useState } from "react";
import { CheckCircle2 } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";
import { Field, FieldLabel } from "@/shared/ui/field";
import { toast } from "@/shared/hooks/use-toast";
import { DrawerBody } from "@/shared/layout";
import { reportEventToBackend } from "@/features/events/api/events.api";
import { getApiErrorMessage } from "@/shared/services/apiClient";

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
      setIsSubmitted(true);
    } catch (err) {
      console.error("Failed to report event:", err);
      toast({
        description: getApiErrorMessage(
          err,
          t("events.reportDialog.submitFailed"),
        ),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DrawerContent className="overflow-hidden p-0">
        {isSubmitted ? (
          <>
            <DrawerBody className="mx-auto w-full max-w-md">
              <DrawerHeader className="p-0 text-left">
                <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CheckCircle2 className="size-5" />
                </div>
                <DrawerTitle>{t("events.reportDialog.submittedTitle")}</DrawerTitle>
                <DrawerDescription>
                  {t("events.reportDialog.submittedDescription", { title: eventTitle })}
                </DrawerDescription>
              </DrawerHeader>
            </DrawerBody>
          </>
        ) : (
          <>
            <DrawerBody className="mx-auto w-full max-w-md">
              <DrawerHeader className="p-0 text-left">
                <DrawerTitle>{t("events.reportDialog.title")}</DrawerTitle>
                <DrawerDescription>
                  {t("events.reportDialog.description", { title: eventTitle })}
                </DrawerDescription>
              </DrawerHeader>

              <Field>
                <FieldLabel htmlFor="event-report-reason">
                  {t("events.reportDialog.placeholder")}
                </FieldLabel>
                <Textarea
                  id="event-report-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  className="min-h-28"
                  disabled={isSubmitting}
                  autoFocus
                />
              </Field>
            </DrawerBody>
            <DrawerFooter className="flex-row justify-end gap-2">
              <LoadingButton
                type="button"
                onMouseDown={handleSubmit}
                disabled={!trimmedReason}
                isLoading={isSubmitting}
                loadingText={t("common.submitting")}
              >
                {t("events.reportDialog.submit")}
              </LoadingButton>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
