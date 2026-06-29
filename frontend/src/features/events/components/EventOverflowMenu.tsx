import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Share2, Trash2 } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

type EventOverflowAction = "share" | "report" | "delete";

interface EventOverflowMenuProps {
  children: ReactElement;
  onAction: (action: EventOverflowAction) => void;
  canDelete?: boolean;
  contentClassName?: string;
  stopPropagation?: boolean;
}

export function EventOverflowMenu({
  children,
  onAction,
  canDelete = false,
  contentClassName = "w-44",
  stopPropagation = false,
}: EventOverflowMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className={contentClassName} align="end" stopPropagation={stopPropagation}>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onAction("share");
          }}
        >
          <Share2 className="size-3.5 shrink-0" />
          {t("common.share")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onAction("report");
          }}
        >
          <Flag className="size-3.5 shrink-0" />
          {t("common.report")}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              onAction("delete");
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            {t("common.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
