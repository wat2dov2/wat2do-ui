"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { Calendar } from "@/shared/ui/calendar"
import { CalendarDays } from "@/shared/ui/doodle-icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover"

interface DatePickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder: string
  className?: string
  hasError?: boolean
  disabled?: boolean
}

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return undefined
  }
  return date
}

function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  hasError = false,
  disabled = false,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const date = useMemo(() => parseLocalDate(value), [value])

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return
    onChange(format(selectedDate, "yyyy-MM-dd"))
    onBlur?.()
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="secondary"
          disabled={disabled}
          className={cn(
            "w-full min-w-0 justify-start border border-border px-3 text-left font-normal text-secondary-foreground hover:bg-muted-hover",
            !date && "text-muted-foreground",
            hasError && "bg-destructive/10 ring-2 ring-destructive/50",
            className,
          )}
          onBlur={onBlur}
        >
          <CalendarDays aria-hidden="true" />
          <span className="min-w-0 truncate">
            {date ? format(date, "PPP") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleDateSelect}
          defaultMonth={date}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
