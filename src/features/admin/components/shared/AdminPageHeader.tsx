/**
 * Admin Page Header Component
 * Reusable page header with icon, title, and action button
 */

import React from "react";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface AdminPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onBack?: () => void;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
}

export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  onBack,
  action,
}: AdminPageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action && (
        <Button onClick={action.onClick}>
          {action.icon && <action.icon className="w-4 h-4 mr-2" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
