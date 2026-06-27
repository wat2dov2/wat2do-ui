import { Check } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/shared/ui/drawer";
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
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="p-4">
        <DrawerTitle className="sr-only">{t("events.eventPromoted")}</DrawerTitle>
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-y-4 py-6 text-center">
          <div className="size-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Check className="size-8 text-white" strokeWidth={3} />
          </div>

          <h2 className="text-xl font-semibold text-foreground">
            {t("events.eventPromoted")}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}" {t("events.eventPromotedDesc")}
          </p>

          <Button onMouseDown={onClose} className="w-full">
            {t("common.done")}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
