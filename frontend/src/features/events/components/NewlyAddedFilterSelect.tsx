import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { controlBox } from "@/shared/config/controlBox";
import { FilterClearButton } from "@/shared/ui/filter-clear-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export type NewlyAddedFilterValue = "last24Hours" | "sinceLastVisit";

interface NewlyAddedFilterSelectProps {
  value: NewlyAddedFilterValue | null;
  showSinceLastVisit: boolean;
  onValueChange: (value: NewlyAddedFilterValue) => void;
  onClear: () => void;
}

export function NewlyAddedFilterSelect({
  value,
  showSinceLastVisit,
  onValueChange,
  onClear,
}: NewlyAddedFilterSelectProps) {
  const { t } = useTranslation();
  const active = value !== null;
  const last24HoursLabel = t("events.newlyAddedFilter.last24Hours", {
    hours: controlBox.eventDiscovery.newEventWindowHours,
  });
  const label =
    value === "sinceLastVisit"
      ? t("events.newlyAddedFilter.sinceLastVisit")
      : last24HoursLabel;

  return (
    <div className="relative shrink-0">
      <Select
        value={value ?? ""}
        onValueChange={(nextValue) =>
          onValueChange(nextValue as NewlyAddedFilterValue)
        }
      >
        <SelectTrigger
          size="sm"
          aria-label={label}
          className={cn(
            active &&
              "bg-primary pr-16 text-primary-foreground hover:bg-primary-hover [&_svg:not([class*='text-'])]:text-primary-foreground",
          )}
        >
          <SelectValue placeholder={last24HoursLabel} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="last24Hours">
            {last24HoursLabel}
          </SelectItem>
          {showSinceLastVisit ? (
            <SelectItem value="sinceLastVisit">
              {t("events.newlyAddedFilter.sinceLastVisit")}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {active ? (
        <FilterClearButton
          count={1}
          label={t("events.newlyAddedFilter.clear")}
          onClick={onClear}
          className="absolute top-1/2 right-7 -translate-y-1/2"
        />
      ) : null}
    </div>
  );
}
