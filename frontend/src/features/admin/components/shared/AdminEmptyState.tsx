/**
 * Admin Empty State Component
 * Reusable empty state display
 */

import React from "react";
import type { LucideIcon } from "lucide-react";

interface AdminEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function AdminEmptyState({
  icon: Icon,
  title,
  description,
}: AdminEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4">
      <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
        <Icon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        {description}
      </p>
    </div>
  );
}
