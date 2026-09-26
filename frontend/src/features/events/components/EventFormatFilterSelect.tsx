import { useTranslation } from "react-i18next";
import type { EventFormatFilter } from "@/shared/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

interface EventFormatFilterSelectProps {
  value: EventFormatFilter;
  onChange: (value: EventFormatFilter) => void;
}

export function EventFormatFilterSelect({ value, onChange }: EventFormatFilterSelectProps) {
  const { t } = useTranslation();

  return (
    <Select value={value} onValueChange={(next) => onChange(next as EventFormatFilter)}>
      <SelectTrigger
        size="sm"
        variant={value === "any" ? "outline" : "primary"}
        aria-label={t("events.formatFilter.label")}
      >
        <SelectValue>{t(`events.formatFilter.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value="any">{t("events.formatFilter.any")}</SelectItem>
        <SelectItem value="inPerson">{t("events.formatFilter.inPerson")}</SelectItem>
        <SelectItem value="online">{t("events.formatFilter.online")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
