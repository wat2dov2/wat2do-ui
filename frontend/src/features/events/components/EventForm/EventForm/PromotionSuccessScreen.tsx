import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

interface PromotionSuccessScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PromotionSuccessScreen({
  isOpen,
  onClose,
}: PromotionSuccessScreenProps) {
  const { t } = useTranslation();
  const { formData } = useEventFormContext();
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">{t("events.eventPromoted")}</DialogTitle>
        <div className="flex flex-col items-center text-center py-6 gap-y-4">
          <div className="size-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Check className="size-8 text-white" strokeWidth={3} />
          </div>

          <h2 className="text-xl font-semibold text-foreground">
            {t("events.eventPromoted")}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}" {t("events.eventPromotedDesc")}
          </p>

          <Button onClick={onClose} className="w-full">
            {t("common.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
