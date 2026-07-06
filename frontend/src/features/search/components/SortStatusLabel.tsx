import { useTranslation } from "react-i18next";
import { Chip } from "@/shared/ui/chip";

export function SortStatusLabel() {
  const { t } = useTranslation();

  return (
    <Chip
      asChild
      active
      size="md"
      className="cursor-not-allowed shrink-0"
      aria-label={t("filters.sortStatusAria")}
    >
      <span>
        {t("filters.sortStatusLabel")}
      </span>
    </Chip>
  );
}
