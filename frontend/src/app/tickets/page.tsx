"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { MyTicketsPage } from "@/features/tickets";

export default function TicketsPage() {
  return (
    <ProtectedRoute>
      <MyTicketsPage />
    </ProtectedRoute>
  );
}
