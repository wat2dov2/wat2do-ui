/**
 * AdminTable Component
 * Reusable table wrapper for admin pages with consistent styling
 */

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

interface AdminTableProps {
  children: React.ReactNode;
  headers: Array<{
    label: string;
    className?: string;
    align?: "left" | "right" | "center";
  }>;
  className?: string;
}

export function AdminTable({ children, headers, className }: AdminTableProps) {
  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${className || ""}`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted">
            {headers.map((header, index) => (
              <TableHead
                key={index}
                className={`text-xs font-semibold text-gray-900 ${header.align === "right" ? "text-right" : ""} ${header.className || ""}`}
              >
                {header.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}
