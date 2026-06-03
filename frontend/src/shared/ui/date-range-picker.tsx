import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";

interface DateRangePickerProps {
  value: { from: string; to: string };
  onChange: (value: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Select date range",
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedRange = useMemo<DateRange | undefined>(() => {
    if (!value.from) return undefined;
    const fromDate = new Date(value.from + "T00:00:00");
    const toDate = value.to ? new Date(value.to + "T00:00:00") : undefined;
    return {
      from: isNaN(fromDate.getTime()) ? undefined : fromDate,
      to: toDate && isNaN(toDate.getTime()) ? undefined : toDate,
    };
  }, [value]);

  const [localRange, setLocalRange] = useState<DateRange | undefined>(selectedRange);

  // Keep local range in sync with external values (e.g. clear filters)
  useEffect(() => {
    setLocalRange(selectedRange);
  }, [selectedRange]);

  const handleSelect = (range: DateRange | undefined) => {
    setLocalRange(range);

    if (range?.from && range?.to) {
      const nextFrom = format(range.from, "yyyy-MM-dd");
      const nextTo = format(range.to, "yyyy-MM-dd");
      onChange({ from: nextFrom, to: nextTo });
      setIsOpen(false);
    } else if (!range) {
      onChange({ from: "", to: "" });
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      if (localRange?.from && !localRange?.to) {
        // Commit single day selection when user clicks outside
        const dateStr = format(localRange.from, "yyyy-MM-dd");
        onChange({ from: dateStr, to: dateStr });
      } else if (!localRange?.from) {
        onChange({ from: "", to: "" });
      }
    }
  };

  const displayText = useMemo(() => {
    const activeRange = localRange || selectedRange;
    if (!activeRange?.from) {
      return placeholder;
    }
    const formattedFrom = format(activeRange.from, "LLL dd, yyyy");
    if (!activeRange.to) {
      return `${formattedFrom} - ...`;
    }
    const formattedTo = format(activeRange.to, "LLL dd, yyyy");
    return `${formattedFrom} - ${formattedTo}`;
  }, [localRange, selectedRange, placeholder]);

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id="date-range-btn"
            type="button"
            variant="secondary"
            className={cn(
              "w-full justify-start text-left font-normal border border-border px-3 text-xs text-foreground h-9 hover:bg-muted/60 dark:hover:bg-muted/60 rounded-xl",
              !(localRange || selectedRange)?.from && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 size-3.5 text-muted-foreground" />
            <span>{displayText}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={(localRange || selectedRange)?.from}
            selected={localRange}
            onSelect={handleSelect}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
