import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { newlyAddedSince } from "@/shared/utils/date";

interface NewlyAddedFilterButtonProps {
  value: string | null;
  onValueChange: (value: string) => void;
  onClear: () => void;
}

export function NewlyAddedFilterButton({ value, onValueChange, onClear }: NewlyAddedFilterButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      activation="click"
      type="button"
      size="sm"
      variant={value ? "primary" : "outline"}
      aria-pressed={Boolean(value)}
      onClick={() => value ? onClear() : onValueChange(newlyAddedSince())}
    >
      {t("common.newlyAddedFilter.last24Hours")}
    </Button>
  );
}
