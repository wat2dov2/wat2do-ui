import { useTranslation } from "react-i18next";

export function SortStatusLabel() {
  const { t } = useTranslation();

  return (
    <span
      className="flex shrink-0 items-center whitespace-nowrap rounded-xl bg-primary/80 px-3 py-1.5 text-xs font-medium text-primary-foreground"
      aria-label={t("filters.sortStatusAria")}
    >
      {t("filters.sortStatusLabel")}
    </span>
  );
}
