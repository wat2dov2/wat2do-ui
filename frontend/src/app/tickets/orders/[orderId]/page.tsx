"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { TicketOrderPage } from "@/features/tickets";

export default function TicketOrderRoutePage() {
  return (
    <ProtectedRoute>
      <TicketOrderPage />
    </ProtectedRoute>
  );
}
