"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { useEventsStore } from "@/features/events/store/events.store";
import { MarketingPage as MarketingPageContent } from "@/features/marketing/pages/MarketingPage";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export default function MarketingPage() {
  const events = useEventsStore((state) => state.events);

  return (
    <ProtectedRoute requiredRole={ROLE_ADMIN}>
      <MarketingPageContent events={events} />
    </ProtectedRoute>
  );
}
