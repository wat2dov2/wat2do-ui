"use client"

import * as React from "react"

/**
 * Every calendar opens inside a popover, and react-day-picker is most of a
 * date picker's weight, so the month grid loads with the first one opened
 * instead of with every page that has a date field.
 */
const CalendarGrid = React.lazy(() =>
  import("@/shared/ui/calendar-grid").then((module) => ({ default: module.CalendarGrid })),
)

function Calendar(props: React.ComponentProps<typeof CalendarGrid>) {
  return (
    <React.Suspense fallback={<div aria-hidden="true" className="h-64 w-56" />}>
      <CalendarGrid {...props} />
    </React.Suspense>
  )
}

export { Calendar }
