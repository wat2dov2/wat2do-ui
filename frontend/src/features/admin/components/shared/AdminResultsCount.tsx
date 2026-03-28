/**
 * Admin Results Count Component
 * Displays filtered results count
 */

import React from "react";

interface AdminResultsCountProps {
  count: number;
  singularLabel: string;
  pluralLabel: string;
}

export function AdminResultsCount({
  count,
  singularLabel,
  pluralLabel,
}: AdminResultsCountProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-bold text-xl text-foreground">
        {count} {count === 1 ? singularLabel : pluralLabel}
      </span>
    </div>
  );
}
