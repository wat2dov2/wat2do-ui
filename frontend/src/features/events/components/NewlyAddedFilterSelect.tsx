import { useTranslation } from "react-i18next";
import { controlBox } from "@/shared/config/controlBox";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
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
  /** ISO timestamp of the previous visit, used to date the "since last visit" option. */
  lastVisitAt: string | null;
  onValueChange: (value: NewlyAddedFilterValue) => void;
  onClear: () => void;
}

export function NewlyAddedFilterSelect({
  value,
  showSinceLastVisit,
  lastVisitAt,
  onValueChange,
  onClear,
}: NewlyAddedFilterSelectProps) {
  const { t } = useTranslation();
  const active = value !== null;
  const last24HoursLabel = t("events.newlyAddedFilter.last24Hours", {
    hours: controlBox.eventDiscovery.newEventWindowHours,
  });
  const sinceLastVisitLabel = lastVisitAt
    ? t("events.newlyAddedFilter.sinceLastVisitAt", {
        time: formatRelativeTime(lastVisitAt, t, { alwaysAgo: true }),
      })
    : t("events.newlyAddedFilter.sinceLastVisit");
  const label = value === "sinceLastVisit" ? sinceLastVisitLabel : last24HoursLabel;

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
          variant={active ? "primary" : "secondary"}
          aria-label={label}
          className={active ? "pr-11" : undefined}
        >
          <SelectValue placeholder={last24HoursLabel} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="last24Hours">
            {last24HoursLabel}
          </SelectItem>
          {showSinceLastVisit ? (
            <SelectItem value="sinceLastVisit">{sinceLastVisitLabel}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {active ? (
        <FilterClearButton
          count={1}
          label={t("events.newlyAddedFilter.clear")}
          onClick={onClear}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        />
      ) : null}
    </div>
  );
}
