/**
 * Admin Results Count Component
 * Displays filtered results count using the same heading style as events/org pages.
 */

import type { ReactNode } from "react";
import { PageCountHeading } from "@/shared/ui/page-count-heading";

interface AdminResultsCountProps {
  count: number;
  singularLabel: string;
  pluralLabel: string;
  children?: ReactNode;
}

export function AdminResultsCount({
  count,
  singularLabel,
  pluralLabel,
  children,
}: AdminResultsCountProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <PageCountHeading
        count={count}
        label={count === 1 ? singularLabel : pluralLabel}
      />
      {children}
    </div>
  );
}
