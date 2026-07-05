import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { AppleIcon, GoogleIcon } from "@/shared/ui/platform-icons";
import { useMouseDownDropdownTrigger } from "@/shared/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { downloadICS, openGoogleCalendar } from "@/shared/utils/generateICS";
import type { Event } from "@/shared/types";

interface EventCalendarDownloadMenuProps {
  event: Event;
  children: ReactElement;
  contentClassName?: string;
  stopPropagation?: boolean;
}

export function EventCalendarDownloadMenu({
  event,
  children,
  contentClassName = "w-44",
  stopPropagation = false,
}: EventCalendarDownloadMenuProps) {
  const { t } = useTranslation();
  const { open, setOpen, close, triggerChild } = useMouseDownDropdownTrigger(children);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{triggerChild}</DropdownMenuTrigger>
      <DropdownMenuContent className={contentClassName} align="end" stopPropagation={stopPropagation}>
        <DropdownMenuItem
          onSelect={() => {
            openGoogleCalendar(event);
            close();
          }}
        >
          <GoogleIcon className="size-3.5 shrink-0" />
          {t("events.calendar.googleCalendar")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            downloadICS(event);
            close();
          }}
        >
          <AppleIcon className="size-3.5 shrink-0" />
          {t("events.calendar.iCal")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
