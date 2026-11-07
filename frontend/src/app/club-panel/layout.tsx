"use client";

import type { ReactNode } from "react";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { usePreloadClubPanel } from "@/app/routes/clubPanelRoutes";
import { ROLE_CLUB } from "@/shared/constants/roles";

export default function ClubPanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  usePreloadClubPanel();
  return (
    <ProtectedRoute requiredRole={ROLE_CLUB}>
      {children}
    </ProtectedRoute>
  );
}
