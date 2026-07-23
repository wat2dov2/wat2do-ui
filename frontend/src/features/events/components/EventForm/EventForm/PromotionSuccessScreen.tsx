import { Check } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { Section } from "@/shared/layout";

interface PromotionSuccessScreenProps {
  onClose: () => void;
}

export function PromotionSuccessScreen({
  onClose,
}: PromotionSuccessScreenProps) {
  const { t } = useTranslation();
  const { formData } = useEventFormContext();
  return (
    <Section variant="surface" className="mx-auto w-full max-w-md">
      <div className="flex flex-col items-center gap-y-4 py-6 text-center">
        <div className="size-16 rounded-full bg-success flex items-center justify-center">
          <Check className="size-8 text-primary-foreground" strokeWidth={3} />
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
    </Section>
  );
}
