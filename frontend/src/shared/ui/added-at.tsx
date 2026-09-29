import { useTranslation } from "react-i18next";

/** Catalog arrival time, distinct from the event date or application deadline. */
export function AddedAt({ value, timeZone }: { value: string | null | undefined; timeZone: string }) {
  const { t, i18n } = useTranslation();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat(i18n.language, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  }).format(date);
  return (
    <p className="text-sm text-muted-foreground">
      {t("common.addedToWat2Do")} <time dateTime={date.toISOString()}>{formatted}</time>
    </p>
  );
}
