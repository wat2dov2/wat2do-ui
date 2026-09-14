"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { CreateClubPage as CreateClubPageContent } from "@/features/clubs/pages/CreateClubPage";

export default function CreateClubPage() {
  return (
    <ProtectedRoute>
      <CreateClubPageContent />
    </ProtectedRoute>
  );
}
