import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { ClubCategoryBadge } from "@/shared/components/ClubCategoryBadge";

interface ClubCategoryBadgesProps {
  categories: readonly string[];
  maxVisible?: number;
  className?: string;
  badgeClassName?: string;
}

export function ClubCategoryBadges({
  categories,
  maxVisible = categories.length,
  className,
  badgeClassName,
}: ClubCategoryBadgesProps) {
  const visibleCategories = categories.slice(0, maxVisible);
  const overflowCount = Math.max(categories.length - visibleCategories.length, 0);

  if (categories.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {visibleCategories.map((category) => (
        <ClubCategoryBadge key={category} type={category} className={badgeClassName} />
      ))}
      {overflowCount > 0 && (
        <Badge
          variant="secondary"
          size="md"
          className={cn(
            "border-0 font-medium leading-none text-muted-foreground",
            badgeClassName,
          )}
        >
          +{overflowCount}
        </Badge>
      )}
    </div>
  );
}
