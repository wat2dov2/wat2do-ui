import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export type EventBrowseView = "grid" | "map" | "calendar";

export function EventViewSelect({ value, onChange }: { value: EventBrowseView; onChange: (view: EventBrowseView) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={view => {
      if (view === "grid" || view === "map" || view === "calendar") onChange(view);
    }}>
      <SelectTrigger size="sm" data-activation="click" aria-label={t("events.views.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="grid">{t("events.views.grid")}</SelectItem>
        <SelectItem value="map">{t("events.views.map")}</SelectItem>
        <SelectItem value="calendar">{t("events.views.calendar")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
