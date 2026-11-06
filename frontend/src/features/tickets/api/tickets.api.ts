import type {
  ApiEventTicketDeskResponse,
  ApiEventTicketingResponse,
  ApiEventTicketingUpdate,
  ApiTicketAttendee,
  ApiTicketCheckInResponse,
  ApiTicketCheckoutResponse,
  ApiTicketOrderResponse,
  ApiTicketRefundsResponse,
  ApiTicketResponse,
} from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** How the event's tickets work, or null when it has none. */
export function fetchEventTicketing(eventId: number): Promise<ApiEventTicketingResponse | null> {
  return api.get<ApiEventTicketingResponse | null>(`/events/${eventId}/ticketing`);
}

export function configureEventTicketing(
  eventId: number,
  settings: ApiEventTicketingUpdate,
): Promise<ApiEventTicketingResponse> {
  return api.put<ApiEventTicketingResponse>(`/events/${eventId}/ticketing`, settings);
}

export function stopEventTicketing(eventId: number): Promise<void> {
  return api.delete<void>(`/events/${eventId}/ticketing`);
}

/** Take the event's free ticket to one date; taking it again returns the same ticket. */
export function takeFreeTicket(eventId: number, eventDateId: string): Promise<ApiTicketResponse> {
  return api.post<ApiTicketResponse>(`/events/${eventId}/ticketing/tickets`, {
    event_date_id: eventDateId,
  });
}

export function startTicketCheckout(
  eventId: number,
  eventDateId: string,
  quantity: number,
): Promise<ApiTicketCheckoutResponse> {
  return api.post<ApiTicketCheckoutResponse>(`/events/${eventId}/ticketing/checkout`, {
    event_date_id: eventDateId,
    quantity,
  });
}

export function fetchTicketDesk(eventId: number): Promise<ApiEventTicketDeskResponse> {
  return api.get<ApiEventTicketDeskResponse>(`/events/${eventId}/ticketing/desk`);
}

export function setTicketCheckIn(
  eventId: number,
  code: string,
  checkedIn: boolean,
): Promise<ApiTicketCheckInResponse> {
  return api.put<ApiTicketCheckInResponse>(
    `/events/${eventId}/ticketing/check-ins/${encodeURIComponent(code)}`,
    { checked_in: checkedIn },
  );
}

export function refundTicket(eventId: number, ticketId: string): Promise<ApiTicketAttendee> {
  return api.post<ApiTicketAttendee>(`/events/${eventId}/ticketing/tickets/${ticketId}/refund`);
}

export function declineRefundRequest(eventId: number, ticketId: string): Promise<ApiTicketAttendee> {
  return api.post<ApiTicketAttendee>(
    `/events/${eventId}/ticketing/tickets/${ticketId}/refund-request/decline`,
  );
}

export function refundRemainingTickets(eventId: number): Promise<ApiTicketRefundsResponse> {
  return api.post<ApiTicketRefundsResponse>(`/events/${eventId}/ticketing/refunds`);
}

export function fetchMyTickets(): Promise<ApiTicketResponse[]> {
  return api.get<ApiTicketResponse[]>("/tickets/mine");
}

export function fetchTicketOrder(orderId: string): Promise<ApiTicketOrderResponse> {
  return api.get<ApiTicketOrderResponse>(`/tickets/orders/${orderId}`);
}

export function fetchTicket(code: string): Promise<ApiTicketResponse> {
  return api.get<ApiTicketResponse>(`/tickets/${encodeURIComponent(code)}`);
}

/** Give a free ticket back, so someone else can take the seat. */
export function returnTicket(code: string): Promise<void> {
  return api.delete<void>(`/tickets/${encodeURIComponent(code)}`);
}

/** The holder of a paid ticket asks the club for a refund; the club decides. */
export function requestTicketRefund(code: string, note: string | null): Promise<ApiTicketResponse> {
  return api.post<ApiTicketResponse>(`/tickets/${encodeURIComponent(code)}/refund-request`, {
    note,
  });
}
