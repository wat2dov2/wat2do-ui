import { useMemo, useState } from "react";
import { format } from "date-fns";

import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";

interface DateTimePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
}

function parseLocalDateTime(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatLocalDateTime(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

const HOURS = Array.from({ length: 12 }, (_, index) => 12 - index);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
const PERIODS = ["AM", "PM"] as const;

export function DateTimePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "MM/DD/YYYY hh:mm aa",
  className,
  hasError = false,
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const date = useMemo(() => parseLocalDateTime(value), [value]);

  const commitDate = (nextDate: Date) => {
    onChange(formatLocalDateTime(nextDate));
  };

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return;
    const nextDate = new Date(selectedDate);
    if (date) {
      nextDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
    }
    commitDate(nextDate);
    onBlur?.();
  };

  const handleTimeChange = (type: "hour" | "minute" | "ampm", option: string) => {
    if (!date) return;

    const nextDate = new Date(date);
    if (type === "hour") {
      const selectedHour = Number(option) % 12;
      nextDate.setHours(selectedHour + (nextDate.getHours() >= 12 ? 12 : 0));
    } else if (type === "minute") {
      nextDate.setMinutes(Number(option));
    } else if (option === "PM" && nextDate.getHours() < 12) {
      nextDate.setHours(nextDate.getHours() + 12);
    } else if (option === "AM" && nextDate.getHours() >= 12) {
      nextDate.setHours(nextDate.getHours() - 12);
    }

    commitDate(nextDate);
    onBlur?.();
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="secondary"
          className={cn(
            "min-h-10 w-full min-w-0 justify-start border border-border px-3 text-left font-normal text-secondary-foreground hover:bg-muted/60 dark:hover:bg-muted/60",
            !date && "text-muted-foreground",
            hasError && "ring-2 ring-destructive/50 bg-destructive/10",
            className
          )}
          onBlur={onBlur}
        >
          <span className="min-w-0 truncate">
            {date ? format(date, "MM/dd/yyyy hh:mm aa") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[calc(100vw-16px)] overflow-x-auto p-0" align="start">
        <div className="w-max sm:flex">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            defaultMonth={date}
            autoFocus
          />
          <div className="flex flex-col sm:flex-row sm:h-[300px] divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="w-64 sm:w-auto overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {HOURS.map((hour) => (
                  <Button
                    key={hour}
                    type="button"
                    size="icon"
                    variant={date && date.getHours() % 12 === hour % 12 ? "default" : "ghost"}
                    className="sm:w-full shrink-0 aspect-square"
                    onMouseDown={() => handleTimeChange("hour", String(hour))}
                  >
                    {hour}
                  </Button>
                ))}
              </div>
            </div>
            <div className="w-64 sm:w-auto overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {MINUTES.map((minute) => (
                  <Button
                    key={minute}
                    type="button"
                    size="icon"
                    variant={date && date.getMinutes() === minute ? "default" : "ghost"}
                    className="sm:w-full shrink-0 aspect-square"
                    onMouseDown={() => handleTimeChange("minute", String(minute))}
                  >
                    {String(minute).padStart(2, "0")}
                  </Button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {PERIODS.map((period) => (
                  <Button
                    key={period}
                    type="button"
                    size="icon"
                    variant={
                      date &&
                      ((period === "AM" && date.getHours() < 12) ||
                        (period === "PM" && date.getHours() >= 12))
                        ? "default"
                        : "ghost"
                    }
                    className="sm:w-full shrink-0 aspect-square"
                    onMouseDown={() => handleTimeChange("ampm", period)}
                  >
                    {period}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
