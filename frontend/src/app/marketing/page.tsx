"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { useQuery } from "@tanstack/react-query";
import { useRequestSchool } from "@/app/client-providers";
import { eventFeedQueryOptions } from "@/features/events/api/events.api";
import { MarketingPage as MarketingPageContent } from "@/features/marketing/pages/MarketingPage";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export default function MarketingPage() {
  const school = useRequestSchool();
  const { data } = useQuery(eventFeedQueryOptions(school));

  return (
    <ProtectedRoute requiredRole={ROLE_ADMIN}>
      <MarketingPageContent events={data?.items ?? []} />
    </ProtectedRoute>
  );
}
