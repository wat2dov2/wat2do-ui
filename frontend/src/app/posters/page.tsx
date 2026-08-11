"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { PromoterPostersPage } from "@/features/posters/pages/PromoterPostersPage";

export default function PostersPage() {
  return (
    <ProtectedRoute>
      <PromoterPostersPage />
    </ProtectedRoute>
  );
}
