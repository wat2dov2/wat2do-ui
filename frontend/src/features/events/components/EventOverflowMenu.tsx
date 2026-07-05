import type { ReactElement, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Share2, Trash2 } from "@/shared/ui/doodle-icons";
import { useMouseDownDropdownTrigger } from "@/shared/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  registerTrailingClickSwallow,
} from "@/shared/ui/dropdown-menu";

type EventOverflowAction = "share" | "report" | "delete";

interface EventOverflowMenuProps {
  children: ReactElement;
  onAction: (action: EventOverflowAction) => void;
  canDelete?: boolean;
  contentClassName?: string;
  stopPropagation?: boolean;
}

function runOverflowMenuAction(
  event: React.MouseEvent<HTMLDivElement>,
  action: () => void,
) {
  event.preventDefault();
  registerTrailingClickSwallow();
  action();
}

export function EventOverflowMenu({
  children,
  onAction,
  canDelete = false,
  contentClassName = "w-44",
  stopPropagation = false,
}: EventOverflowMenuProps) {
  const { t } = useTranslation();
  const { open, setOpen, close, triggerChild } = useMouseDownDropdownTrigger(children);

  const handleAction = (action: EventOverflowAction) => {
    onAction(action);
    close();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{triggerChild}</DropdownMenuTrigger>
      <DropdownMenuContent className={contentClassName} align="end" stopPropagation={stopPropagation}>
        <DropdownMenuItem
          onMouseDown={(event: MouseEvent<HTMLDivElement>) =>
            runOverflowMenuAction(event, () => handleAction("share"))
          }
        >
          <Share2 className="size-3.5 shrink-0" />
          {t("common.share")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onMouseDown={(event: MouseEvent<HTMLDivElement>) =>
            runOverflowMenuAction(event, () => handleAction("report"))
          }
        >
          <Flag className="size-3.5 shrink-0" />
          {t("common.report")}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => handleAction("delete")}
          >
            <Trash2 className="size-3.5 shrink-0" />
            {t("common.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
