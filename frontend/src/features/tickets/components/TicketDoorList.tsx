import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTicketCheckIn, useTicketRefunds } from "@/features/tickets/hooks/useTickets";
import { TicketStatusBadge } from "@/features/tickets/components/TicketStatusBadge";
import { formatTicketCode, refundRequestState } from "@/features/tickets/lib/ticketFormat";
import type { ApiTicketAttendee } from "@/shared/generated";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { toast } from "@/shared/hooks/use-toast";
import { Stack } from "@/shared/layout";
import { EmptyState } from "@/shared/feedback";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Users } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { formatCents } from "@/shared/utils/currency";
import { formatOccurrence } from "@/shared/utils/date";

interface TicketDoorListProps {
  eventId: number;
  school: string | null | undefined;
  currency: string;
  attendees: ApiTicketAttendee[];
  dates: Array<{ event_date_id: string; dtstart_utc: string }>;
}

/** Everyone holding a ticket: find them, admit them, or refund them. */
export function TicketDoorList({ eventId, school, currency, attendees, dates }: TicketDoorListProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const checkIn = useTicketCheckIn(eventId);
  const { refundOne, declineRequest } = useTicketRefunds(eventId);
  const [query, setQuery] = useState("");
  const [refunding, setRefunding] = useState<ApiTicketAttendee | null>(null);
  const [declining, setDeclining] = useState<ApiTicketAttendee | null>(null);
  const showDates = dates.length > 1;
  const dateLabels = useMemo(
    () =>
      new Map(
        dates.map((date) => [
          date.event_date_id,
          formatOccurrence(date, getSchoolTimezone(school), i18n.language),
        ]),
      ),
    [dates, getSchoolTimezone, i18n.language, school],
  );

  // Holders waiting on an answer come first, so a request never sits unseen at the bottom.
  const ordered = useMemo(
    () =>
      [...attendees].sort(
        (a, b) =>
          Number(refundRequestState(b) === "waiting") - Number(refundRequestState(a) === "waiting"),
      ),
    [attendees],
  );
  const needle = query.trim().toLowerCase().replace(/\s/g, "");
  const visible = needle
    ? ordered.filter((attendee) =>
        [attendee.holder_name, attendee.holder_email, attendee.code].some((value) =>
          value.toLowerCase().replace(/\s/g, "").includes(needle),
        ),
      )
    : ordered;

  if (!attendees.length) {
    return <EmptyState icon={<Users />} title={t("tickets.desk.attendeesEmpty")} />;
  }

  const refundAmount = refunding ? formatCents(refunding.amount_cents, currency, i18n.language) : "";

  return (
    <Stack gap={3}>
      <Input
        type="search"
        aria-label={t("tickets.desk.search")}
        placeholder={t("tickets.desk.search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("tickets.desk.columns.holder")}</TableHead>
            {showDates ? <TableHead>{t("tickets.desk.columns.date")}</TableHead> : null}
            <TableHead>{t("tickets.desk.columns.status")}</TableHead>
            <TableHead>{t("tickets.desk.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length ? null : (
            <TableRow>
              <TableCell colSpan={showDates ? 4 : 3} className="text-center text-muted-foreground">
                {t("events.noResults")}
              </TableCell>
            </TableRow>
          )}
          {visible.map((attendee) => (
            <TableRow key={attendee.id}>
              <TableCell>
                <Stack gap={1}>
                  <span>{attendee.holder_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {attendee.holder_email} · {formatTicketCode(attendee.code).slice(0, 9)}
                  </span>
                  {refundRequestState(attendee) === "waiting" && attendee.refund_request_note ? (
                    <span className="max-w-md text-sm italic text-foreground">
                      “{attendee.refund_request_note}”
                    </span>
                  ) : null}
                </Stack>
              </TableCell>
              {showDates ? <TableCell>{dateLabels.get(attendee.event_date_id)}</TableCell> : null}
              <TableCell>
                <Stack direction="horizontal" gap={2} align="center" wrap>
                  <TicketStatusBadge status={attendee.status} checkedInAt={attendee.checked_in_at} />
                  {refundRequestState(attendee) === "waiting" ? (
                    <Badge variant="warning">{t("tickets.desk.refundRequested")}</Badge>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                {attendee.status === "valid" ? (
                  <Stack direction="horizontal" gap={2}>
                    <Button
                      type="button"
                      size="sm"
                      variant={attendee.checked_in_at ? "outline" : "primary"}
                      disabled={checkIn.isPending}
                      onClick={() =>
                        checkIn.mutate({ code: attendee.code, checkedIn: !attendee.checked_in_at })
                      }
                    >
                      {attendee.checked_in_at ? t("tickets.door.undo") : t("tickets.door.checkIn")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRefunding(attendee)}>
                      {t("tickets.desk.refund")}
                    </Button>
                    {refundRequestState(attendee) === "waiting" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(attendee)}>
                        {t("tickets.desk.decline")}
                      </Button>
                    ) : null}
                  </Stack>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={refunding !== null} onOpenChange={(open) => (open ? null : setRefunding(null))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("tickets.desk.refundTitle")}</DialogTitle>
            <DialogDescription>
              {t("tickets.desk.refundDescription", {
                name: refunding?.holder_name ?? "",
                amount: refundAmount,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRefunding(null)}>
              {t("common.cancel")}
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              isLoading={refundOne.isPending}
              onClick={() =>
                refunding &&
                refundOne.mutate(refunding.id, { onSuccess: () => setRefunding(null) })
              }
            >
              {t("tickets.desk.refundConfirm", { amount: refundAmount })}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declining !== null} onOpenChange={(open) => (open ? null : setDeclining(null))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("tickets.desk.declineTitle")}</DialogTitle>
            <DialogDescription>
              {t("tickets.desk.declineDescription", { name: declining?.holder_name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeclining(null)}>
              {t("common.cancel")}
            </Button>
            <LoadingButton
              type="button"
              isLoading={declineRequest.isPending}
              onClick={() =>
                declining &&
                declineRequest.mutate(declining.id, {
                  onSuccess: () => {
                    setDeclining(null);
                    toast({ description: t("tickets.desk.declined") });
                  },
                })
              }
            >
              {t("tickets.desk.declineConfirm")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
