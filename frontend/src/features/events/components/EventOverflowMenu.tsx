import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Share2, Trash2 } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type EventOverflowAction = "share" | "report" | "delete";

interface EventOverflowMenuProps {
  children: ReactElement;
  onAction: (action: EventOverflowAction) => void;
  canDelete?: boolean;
  contentClassName?: string;
  stopPropagation?: boolean;
  triggerTooltip?: string;
}

export function EventOverflowMenu({
  children,
  onAction,
  canDelete = false,
  contentClassName = "w-44",
  stopPropagation = false,
  triggerTooltip,
}: EventOverflowMenuProps) {
  const { t } = useTranslation();

  const menuTrigger = <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>;

  return (
    <DropdownMenu>
      {triggerTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{menuTrigger}</TooltipTrigger>
          <TooltipContent>
            <p>{triggerTooltip}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        menuTrigger
      )}
      <DropdownMenuContent className={contentClassName} align="end" stopPropagation={stopPropagation}>
        <DropdownMenuItem onSelect={() => onAction("share")}>
          <Share2 className="size-3.5 shrink-0" />
          {t("common.share")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("report")}>
          <Flag className="size-3.5 shrink-0" />
          {t("common.report")}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
            <Trash2 className="size-3.5 shrink-0" />
            {t("common.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
