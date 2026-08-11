"use client";

import type { ReactNode } from "react";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ROLE_ADMIN } from "@/shared/constants/roles";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <ProtectedRoute requiredRole={ROLE_ADMIN}>{children}</ProtectedRoute>;
}
