import { useTranslation } from "react-i18next";

export function SortStatusLabel() {
  const { t } = useTranslation();

  return (
    <span
      className="flex shrink-0 cursor-not-allowed items-center whitespace-nowrap rounded-xl bg-foreground px-3 py-1.5 text-xs font-medium text-background dark:bg-[#e7e5e4] dark:text-[#1c1917]"
      aria-label={t("filters.sortStatusAria")}
    >
      {t("filters.sortStatusLabel")}
    </span>
  );
}
