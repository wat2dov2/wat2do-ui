import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import type { ApiEventTicketingUpdate, ApiTicketOrderResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import {
  configureEventTicketing,
  declineRefundRequest,
  fetchEventTicketing,
  fetchMyTickets,
  fetchTicket,
  fetchTicketOrder,
  fetchTicketSales,
  refundRemainingTickets,
  refundTicket,
  requestTicketRefund,
  setTicketCheckIn,
  startTicketCheckout,
  stopSellingTickets,
} from "@/features/tickets/api/tickets.api";

// Stripe usually reports a payment within seconds; the order page checks this often.
const ORDER_POLL_MS = 2000;

function useErrorToast() {
  const { t } = useTranslation();
  return (error: unknown) =>
    toast({
      description: getApiErrorMessage(error, t("tickets.errors.generic")),
      variant: "destructive",
    });
}

/** What an event sells, or null when it doesn't sell tickets. */
export function useEventTicketing(eventId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tickets.event(eventId ?? 0),
    queryFn: () => fetchEventTicketing(eventId as number),
    enabled: eventId != null,
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
    retry: false,
  });
}

/** The buyer's order after Stripe sends them back, polled until it settles. */
export function useTicketOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.tickets.order(orderId),
    queryFn: () => fetchTicketOrder(orderId),
    refetchInterval: (query) =>
      (query.state.data as ApiTicketOrderResponse | undefined)?.status === "pending"
        ? ORDER_POLL_MS
        : false,
  });
}

/** Hold the seats and leave for Stripe Checkout. */
export function useTicketCheckout(eventId: number) {
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (checkout: { eventDateId: string; quantity: number }) =>
      startTicketCheckout(eventId, {
        event_date_id: checkout.eventDateId,
        quantity: checkout.quantity,
      }),
    onSuccess: ({ checkout_url }) => {
      window.location.assign(checkout_url);
    },
    onError: showError,
  });
}

/** The club's sales desk for one event; only events that sell tickets have one. */
export function useTicketSales(eventId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tickets.sales(eventId),
    queryFn: () => fetchTicketSales(eventId),
    enabled,
  });
}

/** Everything that changes when an event's tickets change, refreshed together. */
function useInvalidateEventTickets(eventId: number) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets.sales(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets.event(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.clubTicketing.all }),
    ]);
}

export function useTicketingSettings(eventId: number) {
  const invalidate = useInvalidateEventTickets(eventId);
  const showError = useErrorToast();
  const save = useMutation({
    mutationFn: (settings: ApiEventTicketingUpdate) => configureEventTicketing(eventId, settings),
    onSuccess: invalidate,
    onError: showError,
  });
  const stop = useMutation({
    mutationFn: () => stopSellingTickets(eventId),
    onSuccess: invalidate,
    onError: showError,
  });
  return { save, stop };
}

export function useTicketCheckIn(eventId: number) {
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: ({ code, checkedIn }: { code: string; checkedIn: boolean }) =>
      setTicketCheckIn(eventId, code, checkedIn),
    onSuccess: (_result, { code }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets.ticket(code) }),
      ]),
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

/** The holder asks the club for a refund, from their ticket's page. */
export function useTicketRefundRequest(code: string) {
  const queryClient = useQueryClient();
  const { userId } = useAuthState();
  const showError = useErrorToast();
  return useMutation({
    mutationFn: (note: string) => requestTicketRefund(code, { note: note.trim() || null }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketQueryKey(code, userId), ticket);
      return queryClient.invalidateQueries({ queryKey: queryKeys.tickets.mine(userId) });
    },
    onError: showError,
  });
}
