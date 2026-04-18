import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Calendar } from "@/shared/ui/calendar";

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
}

export function DatePicker({ value, onChange, placeholder }: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {value ? format(value, "PPP") : (placeholder || t("forms.selectDate"))}
          </span>
          <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 bg-popover border-border"
        align="start"
      >
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
          defaultMonth={value}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}
