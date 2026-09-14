import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/shared/ui/badge";
import {
  getClubCategoryConfig,
  clubCategoryInk,
} from "@/shared/data/clubCategoryStyles";

type BadgeSize = NonNullable<ComponentProps<typeof Badge>["size"]>;

/** Icon scales with the badge so the chip stays balanced at every size. */
const ICON_SIZE: Record<BadgeSize, number> = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 18,
};

interface ClubCategoryBadgeProps {
  /** Category slug or label; anything unrecognized falls back to the neutral config. */
  type: string | null | undefined;
  /** Wraps the badge, e.g. to make it a button. Receives the rendered content. */
  children?: (content: ReactNode) => ReactNode;
  size?: BadgeSize;
  className?: string;
}

/**
 * Category chip for clubs: registry icon, colour, and label.
 *
 * All three come from `clubCategoryStyles` keyed by the same slug, so the card
 * never maps a category to a colour or an SVG filename itself. Sizing comes from the
 * Badge primitive, so this chip lines up with the other badges wherever it is used.
 */
export function ClubCategoryBadge({
  type,
  children,
  size = "md",
  className,
}: ClubCategoryBadgeProps) {
  const config = getClubCategoryConfig(type);
  const iconSize = ICON_SIZE[size];

  const content = (
    <Badge
      variant="category"
      size={size}
      className={className}
      style={{ backgroundColor: config.color, color: clubCategoryInk }}
    >
      <img
        src={config.icon}
        alt=""
        aria-hidden="true"
        width={iconSize}
        height={iconSize}
        className="shrink-0"
      />
      <span className="truncate">{config.label}</span>
    </Badge>
  );

  return <>{children ? children(content) : content}</>;
}
