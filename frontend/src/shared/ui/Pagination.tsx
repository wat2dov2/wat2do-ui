/**
 * Pagination Component
 * Reusable pagination controls shared across features.
 */

import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  itemLabel: string;
  itemLabelPlural: string;
  onPageChange: (page: number) => void;
  hideDetails?: boolean;
}

function getPageNumbers(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "...",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel,
  itemLabelPlural,
  onPageChange,
  hideDetails,
}: PaginationProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div className={`flex w-full flex-col gap-2 sm:flex-row sm:items-center ${hideDetails ? "sm:justify-end" : "sm:justify-between"}`}>
      {!hideDetails && (
        <div className="text-sm text-muted-foreground">
          {t("admin.showing")} {startItem} {t("admin.to")} {endItem}{" "}
          {t("common.of")} {totalItems}{" "}
          {totalItems === 1 ? itemLabel : itemLabelPlural}
        </div>
      )}
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1">
        <Button
          variant="outline"
          size="sm"
          onMouseDown={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="h-7 text-xs px-2 gap-1 rounded-lg"
        >
          <ChevronLeft className="size-3.5" />
          {t("admin.previous")}
        </Button>
        <div className="flex items-center gap-1">
          {getPageNumbers(currentPage, totalPages).map((pageNum, i) => {
            if (pageNum === "...") {
              return (
                <span
                  key={`ellipsis-${i}`}
                  className="flex size-7 items-center justify-center text-xs text-muted-foreground select-none"
                >
                  ...
                </span>
              );
            }
            return (
              <Button
                key={pageNum}
                variant={currentPage === pageNum ? "default" : "outline"}
                size="sm"
                onMouseDown={() => onPageChange(pageNum)}
                className="w-7 h-7 text-xs p-0 rounded-lg"
              >
                {pageNum}
              </Button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          onMouseDown={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="h-7 text-xs px-2 gap-1 rounded-lg"
        >
          {t("admin.next")}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
