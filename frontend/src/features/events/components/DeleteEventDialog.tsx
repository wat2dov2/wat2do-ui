import { useState } from "react";
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

interface DeleteEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventTitle: string;
  onConfirm: () => Promise<void> | void;
}

export function DeleteEventDialog({
  open,
  onOpenChange,
  eventTitle,
  onConfirm,
}: DeleteEventDialogProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onOpenChange(false)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("events.deleteEventTitle")}</DialogTitle>
          <DialogDescription>
            {t("events.deleteEventConfirm", { title: eventTitle })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 justify-end mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t("common.cancel")}
          </Button>
          <LoadingButton
            variant="destructive"
            onClick={async () => {
              setIsDeleting(true);
              try {
                await Promise.resolve(onConfirm());
                onOpenChange(false);
              } finally {
                setIsDeleting(false);
              }
            }}
            isLoading={isDeleting}
            loadingText={t("common.pleaseWait") || "Please wait..."}
          >
            {t("common.delete")}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
