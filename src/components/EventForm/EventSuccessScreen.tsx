import React from "react";
import { Check, Sparkles, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EventFormData } from "@/types";
import { formatEventDate, formatTime } from "@/utils/date";

interface EventSuccessScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote: () => void;
  formData: EventFormData;
  isEditMode: boolean;
  onShowSuccessAlert: (message: string) => void;
}

export function EventSuccessScreen({
  isOpen,
  onClose,
  onPromote,
  formData,
  isEditMode,
  onShowSuccessAlert,
}: EventSuccessScreenProps) {
  const handleDone = () => {
    onClose();
    setTimeout(() => {
      onShowSuccessAlert(
        `Event "${formData.title}" has been created successfully!`
      );
    }, 100);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Event Created</DialogTitle>
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
            {isEditMode ? "Event Updated!" : "Event Created!"}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}"{" "}
            {isEditMode
              ? "has been updated."
              : "is now live and visible to students."}
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
              Done
            </Button>
            <Button
              onClick={onPromote}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              <Megaphone className="w-4 h-4 mr-1.5" />
              Promote
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
