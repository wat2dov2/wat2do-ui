import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import {
  getOrganizationCategoryConfig,
  organizationCategoryInk,
} from "@/shared/data/organizationCategoryStyles";

interface OrganizationCategoryBadgeProps {
  /** Category slug or label; anything unrecognized falls back to the neutral config. */
  type: string | null | undefined;
  /** Wraps the badge, e.g. to make it a button. Receives the rendered content. */
  children?: (content: ReactNode) => ReactNode;
  className?: string;
}

/**
 * Category chip for organizations: registry icon, colour, and label.
 *
 * All three come from `organizationCategoryStyles` keyed by the same slug, so the card
 * never maps a category to a colour or an SVG filename itself.
 */
export function OrganizationCategoryBadge({
  type,
  children,
  className,
}: OrganizationCategoryBadgeProps) {
  const config = getOrganizationCategoryConfig(type);

  const content = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-xl px-2.5 py-1",
        "text-[11px] font-bold leading-none",
        className,
      )}
      style={{ backgroundColor: config.color, color: organizationCategoryInk }}
    >
      <img src={config.icon} alt="" aria-hidden="true" width={14} height={14} className="shrink-0" />
      <span className="truncate">{config.label}</span>
    </span>
  );

  return <>{children ? children(content) : content}</>;
}
