import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import type { Event } from "@/shared/types";

interface EventCalendarDownloadMenuProps {
  event: Event;
  children: ReactElement;
  contentClassName?: string;
  stopPropagation?: boolean;
  triggerTooltip?: string;
}

export function EventCalendarDownloadMenu({
  event,
  children,
  contentClassName = "w-44",
  stopPropagation = false,
  triggerTooltip,
}: EventCalendarDownloadMenuProps) {
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
        <DropdownMenuItem onSelect={() => openGoogleCalendar(event)}>
          <GoogleIcon className="size-3.5 shrink-0" />
          {t("events.calendar.googleCalendar")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadICS(event)}>
          <AppleIcon className="size-3.5 shrink-0" />
          {t("events.calendar.iCal")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
