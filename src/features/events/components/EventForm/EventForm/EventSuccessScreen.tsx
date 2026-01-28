import React from "react";
import { Check, Sparkles, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { formatEventDate, formatTime } from "@/shared/utils/date";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

interface EventSuccessScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote: () => void;
  isEditMode: boolean;
  onShowSuccessAlert: (message: string) => void;
}

export function EventSuccessScreen({
  isOpen,
  onClose,
  onPromote,
  isEditMode,
  onShowSuccessAlert,
}: EventSuccessScreenProps) {
  const { t } = useTranslation();
  const { formData } = useEventFormContext();
  const handleDone = () => {
    onClose();
    setTimeout(() => {
      onShowSuccessAlert(
        isEditMode
          ? t("events.eventUpdatedMessage", { title: formData.title })
          : t("events.eventCreatedMessage", { title: formData.title })
      );
    }, 100);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">
          {isEditMode ? t("events.eventUpdatedTitle") : t("events.eventCreatedTitle")}
        </DialogTitle>
        <div className="flex flex-col items-center text-center py-4 space-y-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-warning rounded-full flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-foreground">
            {isEditMode ? t("events.eventUpdated") : t("events.eventCreated")}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}" {isEditMode ? t("events.eventUpdatedDesc") : t("events.eventCreatedDesc")}
          </p>

          <div className="w-full rounded-lg p-4 text-left bg-muted space-y-1">
            <p className="font-medium text-foreground">{formData.title}</p>
            <p className="text-sm text-muted-foreground">
              {formData.organization}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatEventDate(formData.date)} at {formatTime(formData.time)}
            </p>
          </div>

          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={handleDone} className="flex-1">
              {t("common.done")}
            </Button>
            <Button
              onClick={onPromote}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              <Megaphone className="w-4 h-4 mr-1.5" />
              {t("events.promote")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
