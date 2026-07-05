import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Check } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  DEFAULT_FILTER_SORT_BY,
  DEFAULT_FILTER_SORT_ORDER,
} from "@/features/search/api/filterService";
import { findSortPreset, SORT_PRESETS } from "@/features/search/constants/sortPresets";

interface SortChipProps {
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (sortBy: string, sortOrder: "asc" | "desc") => void;
}

export function SortChip({ sortBy, sortOrder, onSortChange }: SortChipProps) {
  const { t } = useTranslation();

  const activePreset = useMemo(
    () => findSortPreset(sortBy, sortOrder),
    [sortBy, sortOrder],
  );

  const isDefaultSort =
    sortBy === DEFAULT_FILTER_SORT_BY && sortOrder === DEFAULT_FILTER_SORT_ORDER;

  const activeLabel = activePreset
    ? t(activePreset.labelKey)
    : t("filters.sortHappeningSoon");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-elevation="control"
          aria-haspopup="menu"
          aria-label={t("filters.sortMenuAriaLabel", {
            sort: activeLabel,
            defaultValue: `Sort: ${activeLabel}`,
          })}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
            !isDefaultSort
              ? "bg-primary/80 text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          <ArrowUpDown className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("filters.sortChipLabel", {
              sort: activeLabel,
              defaultValue: `Sort: ${activeLabel}`,
            })}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" stopPropagation>
        {SORT_PRESETS.map((preset) => {
          const selected =
            preset.sortBy === sortBy && preset.sortOrder === sortOrder;

          return (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => onSortChange(preset.sortBy, preset.sortOrder)}
              className={selected ? "font-medium" : undefined}
            >
              <Check
                className={`size-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              />
              {t(preset.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
