"use client";

import type { ReactNode } from "react";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ROLE_ORGANIZATION } from "@/shared/constants/roles";

export default function OrganizationPanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProtectedRoute requiredRole={ROLE_ORGANIZATION}>
      {children}
    </ProtectedRoute>
  );
}
