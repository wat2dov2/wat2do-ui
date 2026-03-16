/**
 * AdminActivityItem Component
 * Reusable activity item for admin activity feed
 */

import React from "react";
import { Clock, ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { LucideIcon } from "lucide-react";

interface AdminActivityItemProps {
  icon: LucideIcon;
  title: React.ReactNode;
  timestamp: string;
  metadata?: React.ReactNode;
  onView?: () => void;
  viewLabel?: string;
}

export function AdminActivityItem({
  icon: Icon,
  title,
  timestamp,
  metadata,
  onView,
  viewLabel,
}: AdminActivityItemProps) {
  return (
    <div className="w-full p-4 hover:bg-muted/50 transition-colors cursor-pointer">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-900 mb-1">{title}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>{timestamp}</span>
                {metadata}
              </div>
            </div>
            {onView && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onView();
                }}
              >
                {viewLabel || "View"}
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
