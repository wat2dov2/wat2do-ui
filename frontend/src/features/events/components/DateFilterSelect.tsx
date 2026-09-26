import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import type { EventDateFilter } from "@/shared/types";
import { parseLocalDateValue, schoolCalendarDate } from "@/shared/utils/date";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

interface DateFilterSelectProps {
  school: string;
  value: EventDateFilter;
  customDate: string;
  onChange: (value: EventDateFilter, customDate?: string) => void;
}

const DATE_FILTER_OPTIONS: EventDateFilter[] = [
  "any",
  "today",
  "tomorrow",
  "thisWeek",
  "thisWeekend",
  "nextWeek",
  "custom",
];

export function DateFilterSelect({
  school,
  value,
  customDate,
  onChange,
}: DateFilterSelectProps) {
  const { t, i18n } = useTranslation();
  const { schoolBySlug } = useSchoolDirectory();
  const timeZone = schoolBySlug.get(school)?.timezone;
  const firstSelectableDate = timeZone
    ? parseLocalDateValue(schoolCalendarDate(new Date(), timeZone).toISOString().slice(0, 10))
    : undefined;
  const [open, setOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const selectedCustomDate = useMemo(
    () => parseLocalDateValue(customDate),
    [customDate],
  );
  const active = value !== "any";
  const customLabel = selectedCustomDate
    ? new Intl.DateTimeFormat(i18n.language || "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(selectedCustomDate)
    : t("events.dateFilter.custom");
  const selectedLabel =
    value === "custom"
      ? customLabel
      : t(`events.dateFilter.${value}`);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setShowCustomPicker(false);
    }
  };

  const handleOptionSelect = (nextValue: EventDateFilter) => {
    if (nextValue === "custom") {
      setShowCustomPicker(true);
      return;
    }
    onChange(nextValue);
    setOpen(false);
  };

  const handleCustomDateSelect = (date: Date | undefined) => {
    if (!date) return;
    onChange("custom", format(date, "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={active ? "primary" : "outline"}
          role="combobox"
          aria-label={t("events.dateFilter.label")}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {selectedLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        variant={showCustomPicker ? "default" : "menu"}
        className={showCustomPicker ? "w-auto p-0" : undefined}
        align="start"
      >
        {showCustomPicker ? (
          <Calendar
            mode="single"
            selected={selectedCustomDate}
            onSelect={handleCustomDateSelect}
            defaultMonth={selectedCustomDate}
            disabled={firstSelectableDate ? { before: firstSelectableDate } : undefined}
            autoFocus
          />
        ) : (
          <div role="listbox" aria-label={t("events.dateFilter.label")}>
            {DATE_FILTER_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                role="option"
                size="sm"
                variant={value === option ? "primary" : "ghost"}
                aria-selected={value === option}
                className="w-full justify-start"
                onClick={() => handleOptionSelect(option)}
              >
                {t(`events.dateFilter.${option}`)}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
