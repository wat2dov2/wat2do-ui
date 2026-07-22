import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  return (
    <div className="flex w-full justify-end">
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("admin.previous")}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="size-7 rounded-lg p-0 text-xs"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span
          aria-current="page"
          className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground"
        >
          {currentPage}
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("admin.next")}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="size-7 rounded-lg p-0 text-xs"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
