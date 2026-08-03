import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { Button } from "@/shared/ui/button";
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
  const last24HoursLabel = t("events.newlyAddedFilter.last24Hours");
  const sinceLastVisitLabel = lastVisitAt
    ? t("events.newlyAddedFilter.sinceLastVisitAt", {
        time: formatRelativeTime(lastVisitAt, t, { alwaysAgo: true }),
      })
    : t("events.newlyAddedFilter.sinceLastVisit");
  const label = value === "sinceLastVisit" ? sinceLastVisitLabel : last24HoursLabel;

  // "Since last visit" only exists for signed-in users. Without it there is
  // nothing to choose between, so the filter is a plain toggle instead of a
  // dropdown holding a single option.
  if (!showSinceLastVisit) {
    return (
      <Button
        type="button"
        size="sm"
        variant={active ? "primary" : "secondary"}
        aria-pressed={active}
        onClick={() => (active ? onClear() : onValueChange("last24Hours"))}
      >
        {last24HoursLabel}
      </Button>
    );
  }

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
