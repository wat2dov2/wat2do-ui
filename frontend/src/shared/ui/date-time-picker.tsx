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
import { parseLocalDateValue } from "@/shared/utils/date";

interface DateTimePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
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
  const date = useMemo(() => parseLocalDateValue(value.slice(0, 10)), [value]);
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));

  const commitDate = (nextDate: Date, nextHour: number, nextMinute: number) => {
    onChange(`${format(nextDate, "yyyy-MM-dd")}T${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`);
  };

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return;
    commitDate(selectedDate, hour, minute);
    onBlur?.();
  };

  const handleTimeChange = (type: "hour" | "minute" | "ampm", option: string) => {
    if (!date) return;

    let nextHour = hour;
    let nextMinute = minute;
    if (type === "hour") {
      const selectedHour = Number(option) % 12;
      nextHour = selectedHour + (hour >= 12 ? 12 : 0);
    } else if (type === "minute") {
      nextMinute = Number(option);
    } else if (option === "PM" && hour < 12) {
      nextHour = hour + 12;
    } else if (option === "AM" && hour >= 12) {
      nextHour = hour - 12;
    }

    commitDate(date, nextHour, nextMinute);
    onBlur?.();
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "w-full min-w-0 justify-start px-3 text-left font-normal",
            !date && "text-muted-foreground",
            hasError && "ring-2 ring-destructive/50 bg-destructive/10",
            className
          )}
          onBlur={onBlur}
        >
          <span className="min-w-0 truncate">
            {date ? `${format(date, "MM/dd/yyyy")} ${String(hour % 12 || 12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}` : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[calc(100vw-16px)] p-0" align="start">
        <div className="flex max-w-full flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            defaultMonth={date}
            autoFocus
          />
          <div className="flex min-w-0 flex-col divide-y divide-border sm:h-[300px] sm:flex-row sm:divide-x sm:divide-y-0">
            <div className="min-w-0 overflow-x-auto sm:h-full sm:w-auto sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {HOURS.map((optionHour) => (
                  <Button
                    key={optionHour}
                    type="button"
                    size="icon"
                    variant={date && hour % 12 === optionHour % 12 ? "primary" : "ghost"}
                    className="sm:w-full shrink-0 aspect-square"
                    onMouseDown={() => handleTimeChange("hour", String(optionHour))}
                  >
                    {optionHour}
                  </Button>
                ))}
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto sm:h-full sm:w-auto sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {MINUTES.map((optionMinute) => (
                  <Button
                    key={optionMinute}
                    type="button"
                    size="icon"
                    variant={date && minute === optionMinute ? "primary" : "ghost"}
                    className="sm:w-full shrink-0 aspect-square"
                    onMouseDown={() => handleTimeChange("minute", String(optionMinute))}
                  >
                    {String(optionMinute).padStart(2, "0")}
                  </Button>
                ))}
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto sm:h-full sm:overflow-x-hidden sm:overflow-y-auto">
              <div className="flex sm:flex-col p-2">
                {PERIODS.map((period) => (
                  <Button
                    key={period}
                    type="button"
                    size="icon"
                    variant={
                      date &&
                      ((period === "AM" && hour < 12) ||
                        (period === "PM" && hour >= 12))
                        ? "primary"
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
