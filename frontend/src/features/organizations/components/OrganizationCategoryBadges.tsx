import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";
import { getCategoryClasses } from "@/shared/utils/event";

interface OrganizationCategoryBadgesProps {
  categories: readonly string[];
  maxVisible?: number;
  className?: string;
  badgeClassName?: string;
}

export function OrganizationCategoryBadges({
  categories,
  maxVisible = categories.length,
  className,
  badgeClassName,
}: OrganizationCategoryBadgesProps) {
  const { t } = useTranslation();
  const visibleCategories = categories.slice(0, maxVisible);
  const overflowCount = Math.max(categories.length - visibleCategories.length, 0);

  if (categories.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {visibleCategories.map((category) => {
        const colors = getCategoryClasses(category);
        const label = getClubCategoryTranslation(category, t);
        return (
          <Badge
            key={category}
            variant="outline"
            title={label}
            className={cn(
              "inline-flex h-6 max-w-full items-center border-0 px-2 py-0 text-[10px] font-medium leading-none",
              colors.bg,
              colors.text,
              badgeClassName,
            )}
          >
            <span className="truncate">{label}</span>
          </Badge>
        );
      })}
      {overflowCount > 0 && (
        <Badge
          variant="secondary"
          className={cn(
            "inline-flex h-6 shrink-0 items-center border-0 px-2 py-0 text-[10px] font-medium leading-none text-muted-foreground",
            badgeClassName,
          )}
        >
          +{overflowCount}
        </Badge>
      )}
    </div>
  );
}
