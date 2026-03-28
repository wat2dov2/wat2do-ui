import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerProps {
  selected?: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

export function DatePicker({ selected, onSelect, onClose }: DatePickerProps) {
  const { t } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(selected || new Date());

  const MONTH_NAMES = [
    t("datePicker.months.january"), t("datePicker.months.february"), t("datePicker.months.march"), t("datePicker.months.april"),
    t("datePicker.months.may"), t("datePicker.months.june"), t("datePicker.months.july"), t("datePicker.months.august"),
    t("datePicker.months.september"), t("datePicker.months.october"), t("datePicker.months.november"), t("datePicker.months.december"),
  ];

  const WEEK_DAYS = [
    t("datePicker.days.su"), t("datePicker.days.mo"), t("datePicker.days.tu"), t("datePicker.days.we"),
    t("datePicker.days.th"), t("datePicker.days.fr"), t("datePicker.days.sa")
  ];

  const daysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const firstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const handlePrevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  };

  const handleNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  };

  const handleDateClick = (day: number) => {
    const selectedDate = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    onSelect(selectedDate);
    onClose();
  };

  const isSelectedDate = (day: number) => {
    if (!selected) return false;
    return (
      selected.getDate() === day &&
      selected.getMonth() === currentMonth.getMonth() &&
      selected.getFullYear() === currentMonth.getFullYear()
    );
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === currentMonth.getMonth() &&
      today.getFullYear() === currentMonth.getFullYear()
    );
  };

  const days = daysInMonth(currentMonth);
  const firstDay = firstDayOfMonth(currentMonth);
  const blanks = Array(firstDay).fill(null);
  const daysArray = Array.from({ length: days }, (_, i) => i + 1);

  return (
    <div
      data-calendar-picker
      className="rounded shadow-xl p-4 w-72 bg-popover border border-border"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevMonth}
          className="w-7 h-7 rounded hover:bg-accent/60 flex items-center justify-center transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <span className="font-bold text-sm text-foreground">
          {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </span>
        <button
          onClick={handleNextMonth}
          className="w-7 h-7 rounded hover:bg-accent/60 flex items-center justify-center transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Week days */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEK_DAYS.map((day) => (
          <div
            key={day}
            className="text-center font-bold text-[10px] uppercase py-2 text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-1">
        {blanks.map((_, i) => (
          <div key={`blank-${i}`} className="w-8 h-8" />
        ))}
        {daysArray.map((day) => {
          const selected = isSelectedDate(day);
          const today = isToday(day);
          return (
            <button
              key={day}
              onClick={() => handleDateClick(day)}
              className={`w-8 h-8 rounded font-medium text-xs transition-all hover:bg-accent/60 cursor-pointer ${
                selected 
                  ? "bg-primary text-primary-foreground font-bold" 
                  : today 
                    ? "text-primary font-bold" 
                    : "text-muted-foreground"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
