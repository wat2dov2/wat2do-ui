import { useState } from "react";
import NextLink from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import eventReminder from "../../../../../backend/controlbox/event_reminder.json" with { type: "json" };
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  AlarmClock,
  Ban,
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarX,
  CircleX,
  HandCoins,
  Sunrise,
  Ticket,
  Undo2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import {
  useMarkNotificationsRead,
  useNotifications,
} from "@/features/notifications/hooks/useNotifications";
import { EmptyState } from "@/shared/feedback";
import type { ApiNotificationKind, ApiNotificationResponse } from "@/shared/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { Popover, PopoverBody, PopoverContent, PopoverHeader, PopoverTrigger } from "@/shared/ui/popover";
import { formatRelativeTime } from "@/shared/utils/relativeTime";

const KIND_ICONS: Record<ApiNotificationKind, LucideIcon> = {
  morning_email: Sunrise,
  event_reminder: AlarmClock,
  event_change: CalendarClock,
  event_cancelled: CalendarX,
  tickets: Ticket,
  ticket_refunded: Undo2,
  refund_requested: HandCoins,
  refund_declined: Ban,
  review_decision: BadgeCheck,
  club_invitation: UserPlus,
};

const REVIEWED = ["club", "claim", "event", "position"] as const;

/** How long before an event its reminder goes out, in the reader's language ("1 hour"). */
function reminderLeadTime(locale: string): string {
  const minutes = eventReminder.lead_minutes;
  const [value, unit] = minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

/** A notification's words, in the reader's language, from its kind and details. */
function notificationCopy(t: TFunction, locale: string, { kind, details }: ApiNotificationResponse) {
  const name = details.name ?? "";
  if (kind === "event_reminder") {
    return {
      title: t("notifications.kinds.event_reminder.title", { name }),
      text: t("notifications.kinds.event_reminder.text", { duration: reminderLeadTime(locale) }),
    };
  }
  if (kind === "tickets") {
    const title = (details.tickets ?? 1) > 1 ? "titleMany" : "title";
    return { title: t(`notifications.kinds.tickets.${title}`, { name }), text: t("notifications.kinds.tickets.text") };
  }
  if (kind === "review_decision") {
    const outcome = details.approved ? "approved" : "rejected";
    const reviewed = REVIEWED.find((noun) => noun === details.reviewed) ?? "event";
    return {
      title: t(`notifications.kinds.review_decision.${outcome}.${reviewed}`, { name }),
      text: t(`notifications.kinds.review_decision.${outcome}.text`),
    };
  }
  return { title: t(`notifications.kinds.${kind}.title`, { name }), text: t(`notifications.kinds.${kind}.text`) };
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: ApiNotificationResponse;
  /** Following a notification's link closes the list. */
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const copy = notificationCopy(t, i18n.language, notification);
  const Icon =
    notification.kind === "review_decision" && !notification.details.approved
      ? CircleX
      : KIND_ICONS[notification.kind];
  const content = (
    <>
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {notification.read ? null : <span className="sr-only">{`${t("notifications.unread")} `}</span>}
          {copy.title}
        </ItemTitle>
        <ItemDescription>{copy.text}</ItemDescription>
        <ItemDescription>
          <time dateTime={notification.created_at}>
            {formatRelativeTime(notification.created_at, t, { locale: i18n.language })}
          </time>
        </ItemDescription>
      </ItemContent>
    </>
  );
  // Unread notifications stand out until the list is closed and read again.
  const variant = notification.read ? "default" : "muted";
  return notification.link ? (
    <Item variant={variant} size="sm" asChild>
      <NextLink href={notification.link} onClick={onOpen}>
        {content}
      </NextLink>
    </Item>
  ) : (
    <Item variant={variant} size="sm">
      {content}
    </Item>
  );
}

/**
 * The bell in the top bar: how many notifications are new, and a list of the
 * newest, one for every email the visitor was sent. Opening it reads the inbox
 * afresh and marks read only what that list shows.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { userId } = useAuthState();
  const inbox = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const unread = inbox.data?.unread_count ?? 0;
  const notifications = inbox.data?.notifications ?? [];

  const handleOpenChange = async (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Read again on closing, so the list shows what was read.
      if (markRead.isSuccess || markRead.isPending) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.inbox(userId ?? "") });
        markRead.reset();
      }
      return;
    }
    const { data } = await inbox.refetch();
    const shownUnread = (data?.notifications ?? [])
      .filter((notification) => !notification.read)
      .map((notification) => notification.id);
    if (shownUnread.length > 0) markRead.mutate(shownUnread);
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}>
      <PopoverTrigger asChild>
        {/* The count sits on the bell's corner, so it never moves the bar. */}
        <Button
          variant="outline"
          size="icon-sm"
          className="relative"
          aria-label={unread > 0 ? t("notifications.openUnread", { count: unread }) : t("notifications.open")}
        >
          <Bell />
          {unread > 0 ? (
            <Badge variant="destructive" size="count" aria-hidden="true" className="absolute -top-1.5 -right-1.5">
              {unread > 9 ? "9+" : unread}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" variant="panel" aria-label={t("notifications.title")}>
        <PopoverHeader>{t("notifications.title")}</PopoverHeader>
        <PopoverBody>
          {inbox.isError ? (
            <EmptyState icon={<Bell />} title={t("notifications.loadFailed")} />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title={inbox.isPending ? t("notifications.loading") : t("notifications.empty")}
              description={inbox.isPending ? undefined : t("notifications.emptyDescription")}
            />
          ) : (
            <Stack gap={1}>
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onOpen={() => void handleOpenChange(false)}
                />
              ))}
            </Stack>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
