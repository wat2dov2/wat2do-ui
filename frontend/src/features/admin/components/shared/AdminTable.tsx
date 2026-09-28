import React from "react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
} from "@/shared/ui/table";
import { Stack } from "@/shared/layout/stack";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { Pagination } from "@/shared/ui/Pagination";
import { cn } from "@/shared/lib/utils";

interface AdminTableProps {
  children: React.ReactNode;
  count: number;
  isLoading?: boolean;
  label: string;
  headers: Array<{
    label: React.ReactNode;
    className?: string;
    align?: "left" | "right" | "center";
  }>;
  className?: string;
  pagination?: React.ComponentProps<typeof Pagination>;
}

const alignClasses = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/** Owns the shared admin result-count/pagination header above the table surface. */
export function AdminTable({ children, count, label, headers, className, pagination, isLoading = false }: AdminTableProps) {
  return (
    <Stack gap={3} data-slot="admin-table">
      <Stack direction="horizontal" align="center" justify="between" gap={3} data-slot="admin-table-header">
        <Stack grow className="min-w-0">
          <PageCountHeading level={2} count={isLoading ? null : count} label={label} />
        </Stack>
        {!isLoading && pagination && pagination.totalPages > 1 ? (
          <Stack className="shrink-0">
            <Pagination {...pagination} />
          </Stack>
        ) : null}
      </Stack>
      <Table className={className} aria-busy={isLoading}>
        <TableHeader>
          <TableRow>
            {headers.map((header, index) => (
              <TableHead
                key={index}
                className={cn(alignClasses[header.align ?? "left"], header.className)}
              >
                {header.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{isLoading ? <TableSkeletonRows columns={headers.length} /> : children}</TableBody>
      </Table>
    </Stack>
  );
}
