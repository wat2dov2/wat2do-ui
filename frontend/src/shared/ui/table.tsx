import * as React from "react"

import { cn } from "@/shared/lib/utils"
import { Stack } from "@/shared/layout/stack"
import { Pagination } from "@/shared/ui/Pagination"

type TableProps = React.ComponentProps<"table"> & {
  pagination?: React.ComponentProps<typeof Pagination>
}

function Table({ className, pagination, ...props }: TableProps) {
  return (
    <Stack gap={3} data-slot="table-layout">
      {pagination && <Pagination {...pagination} />}
      <div
        data-slot="table-container"
        className="relative w-full overflow-hidden rounded-xl border border-border bg-surface"
      >
        <div className="w-full overflow-x-auto">
          <table
            data-slot="table"
            className={cn("w-full caption-bottom text-sm", className)}
            {...props}
          />
        </div>
      </div>
    </Stack>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "bg-secondary [&_tr]:border-b [&_tr:first-child_th:first-child]:rounded-tl-xl [&_tr:first-child_th:last-child]:rounded-tr-xl",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0 [&_tr:last-child_td:first-child]:rounded-bl-xl [&_tr:last-child_td:last-child]:rounded-br-xl",
        className
      )}
      {...props}
    />
  )
}


type TableRowProps = React.ComponentProps<"tr"> & {
  /** Row opens something on click, e.g. a detail drawer. */
  interactive?: boolean
}

function TableRow({ className, interactive, ...props }: TableRowProps) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-surface-hover data-[state=selected]:bg-secondary border-b transition-colors",
        interactive && "cursor-pointer",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-secondary-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

type TableCellProps = React.ComponentProps<"td"> & {
  variant?: "default" | "prose"
}

function TableCell({ className, variant = "default", ...props }: TableCellProps) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        variant === "prose" && "min-w-48 max-w-md whitespace-normal break-words",
        className
      )}
      {...props}
    />
  )
}


export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
}
