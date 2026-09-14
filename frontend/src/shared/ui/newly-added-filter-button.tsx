import { useTranslation } from "react-i18next";
import { controlBox } from "@/shared/config/controlBox";
import { Button } from "@/shared/ui/button";

interface NewlyAddedFilterButtonProps {
  value: string | null;
  onValueChange: (value: string) => void;
  onClear: () => void;
}

export function NewlyAddedFilterButton({ value, onValueChange, onClear }: NewlyAddedFilterButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      variant={value ? "primary" : "outline"}
      aria-pressed={Boolean(value)}
      onClick={() => value
        ? onClear()
        : onValueChange(new Date(Date.now() - controlBox.eventDiscovery.newEventWindowMs).toISOString())}
    >
      {t("common.newlyAddedFilter.last24Hours")}
    </Button>
  );
}
