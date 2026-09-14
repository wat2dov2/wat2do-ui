"use client";

import type { ReactNode } from "react";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ROLE_CLUB } from "@/shared/constants/roles";

export default function ClubPanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProtectedRoute requiredRole={ROLE_CLUB}>
      {children}
    </ProtectedRoute>
  );
}
