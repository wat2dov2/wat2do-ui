import type {
  ApiEventTicketSalesResponse,
  ApiEventTicketingResponse,
  ApiEventTicketingUpdate,
  ApiTicketAttendee,
  ApiTicketCheckInResponse,
  ApiTicketCheckoutCreate,
  ApiTicketCheckoutResponse,
  ApiTicketOrderResponse,
  ApiTicketRefundRequestCreate,
  ApiTicketRefundsResponse,
  ApiTicketResponse,
} from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** What the event sells, or null when it doesn't sell tickets. */
export function fetchEventTicketing(eventId: number): Promise<ApiEventTicketingResponse | null> {
  return api.get<ApiEventTicketingResponse | null>(`/events/${eventId}/ticketing`);
}

export function configureEventTicketing(
  eventId: number,
  settings: ApiEventTicketingUpdate,
): Promise<ApiEventTicketingResponse> {
  return api.put<ApiEventTicketingResponse>(`/events/${eventId}/ticketing`, settings);
}

export function stopSellingTickets(eventId: number): Promise<void> {
  return api.delete<void>(`/events/${eventId}/ticketing`);
}

export function startTicketCheckout(
  eventId: number,
  checkout: ApiTicketCheckoutCreate,
): Promise<ApiTicketCheckoutResponse> {
  return api.post<ApiTicketCheckoutResponse>(`/events/${eventId}/ticketing/checkout`, checkout);
}

export function fetchTicketSales(eventId: number): Promise<ApiEventTicketSalesResponse> {
  return api.get<ApiEventTicketSalesResponse>(`/events/${eventId}/ticketing/sales`);
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

/** The holder asks the club for a refund; the club decides. */
export function requestTicketRefund(
  code: string,
  request: ApiTicketRefundRequestCreate,
): Promise<ApiTicketResponse> {
  return api.post<ApiTicketResponse>(`/tickets/${encodeURIComponent(code)}/refund-request`, request);
}
