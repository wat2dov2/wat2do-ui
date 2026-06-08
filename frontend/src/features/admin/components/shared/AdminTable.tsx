/**
 * AdminTable Component
 * Reusable table wrapper for admin pages with consistent styling
 */

import React from "react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

interface AdminTableProps {
  children: React.ReactNode;
  headers: Array<{
    label: React.ReactNode;
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
          <TableRow className="bg-secondary">
            {headers.map((header, index) => (
              <TableHead
                key={index}
                className={`text-xs font-semibold text-foreground ${header.align === "right" ? "text-right" : ""} ${header.className || ""}`}
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
