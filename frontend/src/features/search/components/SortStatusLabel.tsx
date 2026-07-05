import { useTranslation } from "react-i18next";

export function SortStatusLabel() {
  const { t } = useTranslation();

  return (
    <span
      className="flex shrink-0 items-center whitespace-nowrap rounded-xl bg-secondary px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/80"
      aria-label={t("filters.sortStatusAria")}
    >
      {t("filters.sortStatusLabel")}
    </span>
  );
}
