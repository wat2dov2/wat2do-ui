import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import {
  configureEventTicketing,
  declineRefundRequest,
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
import type { ApiEventTicketingUpdate, ApiTicketOrderResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";

// Stripe usually reports a payment within seconds; the order page checks this often.
const ORDER_POLL_MS = 2000;
// The door list refreshes itself while the desk is open, so two phones at the door agree.
const DESK_POLL_MS = 15000;

function useErrorToast() {
  const { t } = useTranslation();
  return (error: unknown) =>
    toast({
      description: getApiErrorMessage(error, t("tickets.errors.generic")),
      variant: "destructive",
    });
}

/** How the event's tickets work, or null when it has none. */
export function useEventTicketing(eventId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tickets.event(eventId ?? 0),
    queryFn: () => fetchEventTicketing(eventId as number),
    enabled: eventId != null && eventId > 0,
  });
}

export function useMyTickets() {
  const { isAuthenticated, userId } = useAuthState();
  return useQuery({
    queryKey: queryKeys.tickets.mine(userId),
    queryFn: fetchMyTickets,
    enabled: isAuthenticated,
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
function useInvalidateEventTickets(eventId: number) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.clubTicketing.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.goingEvents.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events.attendees(eventId) }),
    ]);
}

/** Take a free ticket: one tap, and the QR code shows up right away. */
export function useTakeFreeTicket(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (eventDateId: string) => takeFreeTicket(eventId, eventDateId),
    onSuccess: invalidate,
    onError: showError,
  });
}

/** Give a free ticket back, freeing the seat. */
export function useReturnTicket(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
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

/** Turn the event's tickets on, change them, or turn them off. */
export function useTicketingSettings(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
  const showError = useErrorToast();
  const save = useMutation({
    mutationFn: (settings: ApiEventTicketingUpdate) => configureEventTicketing(eventId, settings),
    onSuccess: invalidate,
    onError: showError,
  });
  const stop = useMutation({
    mutationFn: () => stopEventTicketing(eventId),
    onSuccess: invalidate,
    onError: showError,
  });
  return { save, stop };
}

export function useTicketCheckIn(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
  const showError = useErrorToast();
  return useMutation({
    mutationFn: ({ code, checkedIn }: { code: string; checkedIn: boolean }) =>
      setTicketCheckIn(eventId, code, checkedIn),
    onSuccess: invalidate,
    onError: showError,
  });
}

export function useTicketRefunds(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
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
