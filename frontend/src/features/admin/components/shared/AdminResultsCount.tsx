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
      <span className="font-bold text-xl text-gray-900">
        {count} {count === 1 ? singularLabel : pluralLabel}
      </span>
    </div>
  );
}
