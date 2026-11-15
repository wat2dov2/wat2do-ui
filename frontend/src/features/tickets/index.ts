import { lazy } from "react";

// The scanner's QR decoder loads only on the scanner page, never with an event page.
export const DoorScanner = lazy(() =>
  import("./components/DoorScanner").then((module) => ({ default: module.DoorScanner })),
);
export { EventTicketCard } from "./components/EventTicketCard";
export { EventTicketsFieldSet } from "./components/EventTicketsFieldSet";
export { HeldTicket } from "./components/HeldTicket";
export { TicketDatePicker } from "./components/TicketDatePicker";
export { TicketDeskStats } from "./components/TicketDeskStats";
export { TicketDoorList } from "./components/TicketDoorList";
export { eventTicketsErrors } from "./lib/eventTicketsForm";
export { currentTicketPriceCents } from "./lib/ticketFormat";
export {
  useClubPayouts,
  useEventTicketing,
  useFreeTicket,
  useMyTickets,
  useSaveEventTickets,
  useTicketDesk,
  useTicketRefunds,
  useTicketUnavailableText,
} from "./hooks/useTickets";
export { MyTicketsPage } from "./pages/MyTicketsPage";
export { TicketOrderPage } from "./pages/TicketOrderPage";
export { TicketPage } from "./pages/TicketPage";
