/**
 * AdminDeleteDialog Component
 * Reusable delete confirmation dialog for admin pages
 */

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

interface AdminDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
}

export function AdminDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  isLoading = false,
}: AdminDeleteDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {cancelLabel || t("common.cancel")}
          </Button>
          <LoadingButton
            variant="destructive"
            onClick={onConfirm}
            isLoading={isLoading}
            loadingText={t("common.pleaseWait")}
          >
            {confirmLabel || t("common.delete")}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
