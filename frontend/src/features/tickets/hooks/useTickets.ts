import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import {
  configureEventTicketing,
  declineRefundRequest,
  fetchClubPayouts,
  fetchEventTicketing,
  fetchMyTickets,
  fetchTicket,
  fetchTicketDesk,
  fetchTicketOrder,
  refundRemainingTickets,
  refundTicket,
  requestTicketRefund,
  returnTicket,
  setTicketCheckIn,
  startTicketCheckout,
  stopEventTicketing,
  takeFreeTicket,
} from "@/features/tickets/api/tickets.api";
import { eventTicketingUpdate } from "@/features/tickets/lib/eventTicketsForm";
import {
  formatOnSale,
  ticketsOnSaleAt,
  ticketUnavailableReason,
  type TicketUnavailable,
} from "@/features/tickets/lib/ticketFormat";
import type {
  ApiEventTicketingResponse,
  ApiTicketCheckInResponse,
  ApiTicketOrderResponse,
} from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import type { Event, EventFormData } from "@/shared/types";

// Stripe usually reports a payment within seconds; the order page checks this often.
const ORDER_POLL_MS = 2000;
// The door list refreshes itself while the desk is open, so two phones at the door agree.
const DESK_POLL_MS = 15000;
// An event page reloads its tickets just after they go on sale, so Get tickets turns on then.
const ON_SALE_MARGIN_MS = 500;
// Browsers' timers overflow past about 24 days; a page open that long checks again sooner.
const ON_SALE_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

function useErrorToast() {
  const { t } = useTranslation();
  return (error: unknown) =>
    toast({
      description: getApiErrorMessage(error, t("tickets.errors.generic")),
      variant: "destructive",
    });
}

/**
 * How the event's tickets work, or null when it has none. While none are on
 * sale yet, it reloads the moment the next release goes on sale.
 */
export function useEventTicketing(eventId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tickets.event(eventId ?? 0),
    queryFn: () => fetchEventTicketing(eventId as number),
    enabled: eventId != null && eventId > 0,
    refetchInterval: (query) => {
      const onSaleAt = ticketsOnSaleAt(query.state.data as ApiEventTicketingResponse | null | undefined);
      if (!onSaleAt) return false;
      const wait = Date.parse(onSaleAt) - Date.now() + ON_SALE_MARGIN_MS;
      return Math.min(Math.max(wait, ON_SALE_MARGIN_MS), ON_SALE_MAX_WAIT_MS);
    },
  });
}

/** The club with this id when the viewer is on its team: it sets the event's tickets, and never gets any. */
export function useTicketsClub(clubId: number | null | undefined) {
  const { clubs } = useAuthState();
  return clubs.find((club) => club.id === clubId) ?? null;
}

/** Why nobody can get a ticket right now, in words; undefined when they can. */
export function useTicketUnavailableText(
  event: Event,
  ticketing: ApiEventTicketingResponse,
  reason: TicketUnavailable | null,
): string | undefined {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  if (!reason) return undefined;
  const onSaleAt = ticketsOnSaleAt(ticketing);
  if (reason === "onSale" && onSaleAt) {
    return t("tickets.card.unavailable.onSale", {
      time: formatOnSale(onSaleAt, getSchoolTimezone(event.school), i18n.language),
    });
  }
  return t(`tickets.card.unavailable.${reason}`);
}

/** Whether the club can sell tickets: paid tickets switched on, and its Stripe account ready. */
export function useClubPayouts(clubId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clubTicketing.payouts(clubId ?? 0),
    queryFn: () => fetchClubPayouts(clubId as number),
    enabled: clubId != null && clubId > 0,
  });
}

export function useMyTickets() {
  const { userId } = useAuthState();
  return useQuery({
    queryKey: queryKeys.tickets.mine(userId),
    queryFn: fetchMyTickets,
    // Keyed by whose tickets they are, so off until that is known.
    enabled: Boolean(userId),
  });
}

/** Keyed by viewer too: what a ticket's page offers depends on who is looking. */
function ticketQueryKey(code: string, userId: string | null) {
  return [...queryKeys.tickets.ticket(code), userId ?? "guest"] as const;
}

export function useTicket(code: string) {
  const { userId } = useAuthState();
  return useQuery({
    queryKey: ticketQueryKey(code, userId),
    queryFn: () => fetchTicket(code),
    enabled: code !== "",
    retry: false,
  });
}

/** The buyer's order after Stripe sends them back, polled until it settles. */
export function useTicketOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.tickets.order(orderId),
    queryFn: () => fetchTicketOrder(orderId),
    enabled: orderId !== "",
    refetchInterval: (query) =>
      (query.state.data as ApiTicketOrderResponse | undefined)?.status === "pending"
        ? ORDER_POLL_MS
        : false,
  });
}

/** The club's counts and door list for one event with tickets. */
export function useTicketDesk(eventId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tickets.desk(eventId),
    queryFn: () => fetchTicketDesk(eventId),
    enabled: enabled && eventId > 0,
    refetchInterval: DESK_POLL_MS,
  });
}

/** Everything an event's tickets touch, refreshed together after a change. */
function useInvalidateEventTickets() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.clubTicketing.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.goingEvents.all }),
    ]);
}

/** Take a free ticket: one tap, and the QR code shows up right away. */
export function useTakeFreeTicket(eventId: number) {
  const invalidate = useInvalidateEventTickets();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (eventDateId: string) => takeFreeTicket(eventId, eventDateId),
    onSuccess: invalidate,
    onError: showError,
  });
}

/**
 * Getting an event's free ticket: the viewer's valid tickets to it, the dates
 * still open to them, the date picked, and taking the ticket.
 */
export function useFreeTicket(event: Event, ticketing: ApiEventTicketingResponse) {
  const { data: myTickets } = useMyTickets();
  const take = useTakeFreeTicket(event.id);
  const held = (myTickets ?? []).filter(
    (ticket) => ticket.event_id === event.id && ticket.status === "valid",
  );
  const heldDates = new Set(held.map((ticket) => ticket.event_date_id));
  const openDates = ticketing.dates.filter(
    (date) => date.open && !heldDates.has(date.event_date_id),
  );
  const [dateId, setDateId] = useState("");
  const selected = openDates.find((date) => date.event_date_id === dateId) ?? openDates[0];
  const ownEvent = useTicketsClub(event.club_id) !== null;
  const unavailable = ticketUnavailableReason(event, ticketing, openDates, ownEvent);
  const takeTicket = () => {
    if (selected && !take.isPending) take.mutate(selected.event_date_id);
  };
  return {
    held,
    openDates,
    selectedDateId: selected?.event_date_id ?? "",
    /** Tickets left for the picked date; null without a limit. */
    remaining: selected?.remaining ?? null,
    selectDate: setDateId,
    unavailable,
    take: takeTicket,
    isPending: take.isPending,
  };
}

/** Give a free ticket back, freeing the seat. */
export function useReturnTicket() {
  const invalidate = useInvalidateEventTickets();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (code: string) => returnTicket(code),
    onSuccess: invalidate,
    onError: showError,
  });
}

/** Hold the seats and leave for Stripe Checkout. */
export function useTicketCheckout(eventId: number) {
  const showError = useErrorToast();
  return useMutation({
    mutationFn: ({ eventDateId, quantity }: { eventDateId: string; quantity: number }) =>
      startTicketCheckout(eventId, eventDateId, quantity),
    onSuccess: ({ checkout_url }) => {
      window.location.assign(checkout_url);
    },
    onError: showError,
  });
}

/**
 * After the event form saves its event: the event's tickets as the form left
 * them, turned off when the form turned them off. Throws what the server refused.
 */
export function useSaveEventTickets() {
  const invalidate = useInvalidateEventTickets();
  return async (event: Event, formData: EventFormData, hadTickets: boolean) => {
    if (formData.tickets.enabled) {
      await configureEventTicketing(event.id, eventTicketingUpdate(event, formData));
    } else if (hadTickets) {
      await stopEventTicketing(event.id);
    } else {
      return;
    }
    await invalidate();
  };
}

// What the door turns away; every other result admitted a ticket or undid an admission.
const TURNED_AWAY: ReadonlySet<ApiTicketCheckInResponse["result"]> = new Set([
  "refunded",
  "wrong_date",
  "not_for_this_event",
  "not_found",
]);

/**
 * Check a ticket in, or undo it. A code the door turns away (another date, a
 * refunded ticket) shows as a toast, unless the screen shows every result
 * itself, as the door scanner does.
 */
export function useTicketCheckIn(eventId: number, { showsResults = false } = {}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateEventTickets();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: ({ code, checkedIn }: { code: string; checkedIn: boolean }) =>
      setTicketCheckIn(eventId, code, checkedIn),
    onSuccess: ({ result }) => {
      if (!showsResults && TURNED_AWAY.has(result)) {
        toast({ description: t(`tickets.door.results.${result}`), variant: "destructive" });
      }
      return invalidate();
    },
    onError: showError,
  });
}

export function useTicketRefunds(eventId: number) {
  const invalidate = useInvalidateEventTickets();
  const showError = useErrorToast();
  const refundOne = useMutation({
    mutationFn: (ticketId: string) => refundTicket(eventId, ticketId),
    onSuccess: invalidate,
    onError: showError,
  });
  const declineRequest = useMutation({
    mutationFn: (ticketId: string) => declineRefundRequest(eventId, ticketId),
    onSuccess: invalidate,
    onError: showError,
  });
  const refundRemaining = useMutation({
    mutationFn: () => refundRemainingTickets(eventId),
    onSuccess: invalidate,
    onError: showError,
  });
  return { refundOne, declineRequest, refundRemaining };
}

/** The holder of a paid ticket asks the club for a refund, from the ticket's page. */
export function useTicketRefundRequest(code: string) {
  const queryClient = useQueryClient();
  const { userId } = useAuthState();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (note: string) => requestTicketRefund(code, note.trim() || null),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketQueryKey(code, userId), ticket);
      return queryClient.invalidateQueries({ queryKey: queryKeys.tickets.mine(userId) });
    },
    onError: showError,
  });
}
