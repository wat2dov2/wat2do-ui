/**
 * Admin Page Header Component
 * Reusable page header with icon, title, and action button
 */

import { ArrowLeft } from "@/shared/ui/doodle-icons";
import type { LucideIcon } from "@/shared/ui/doodle-icons";
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
          <Button variant="secondary" size="icon" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Icon className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action && (
        <Button onClick={action.onClick}>
          {action.icon && <action.icon className="size-4 mr-2" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
