import { lazy } from "react";

// The scanner's QR decoder loads only on the scanner page, never with an event page.
export const DoorScanner = lazy(() =>
  import("./components/DoorScanner").then((module) => ({ default: module.DoorScanner })),
);
export { EventTicketCard } from "./components/EventTicketCard";
export { TicketDeskStats } from "./components/TicketDeskStats";
export { TicketDoorList } from "./components/TicketDoorList";
export { TicketSettingsCard, type TicketPayouts } from "./components/TicketSettingsCard";
export { useEventTicketing, useTicketDesk, useTicketRefunds } from "./hooks/useTickets";
export { MyTicketsPage } from "./pages/MyTicketsPage";
export { TicketOrderPage } from "./pages/TicketOrderPage";
export { TicketPage } from "./pages/TicketPage";
