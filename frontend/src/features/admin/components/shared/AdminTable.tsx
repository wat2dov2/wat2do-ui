import React from "react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { cn } from "@/shared/lib/utils";

interface AdminTableProps {
  children: React.ReactNode;
  headers: Array<{
    label: React.ReactNode;
    className?: string;
    align?: "left" | "right" | "center";
  }>;
  className?: string;
}

const alignClasses = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * Column headers plus a body slot. The surface frame, header background, and
 * header typography live in the Table primitives, so this only maps headers.
 */
export function AdminTable({ children, headers, className }: AdminTableProps) {
  return (
    <Table className={className}>
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
      <TableBody>{children}</TableBody>
    </Table>
  );
}
