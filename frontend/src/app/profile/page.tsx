"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { ProfilePage as ProfilePageContent } from "@/features/profile/pages/ProfilePage";

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <ProfilePageContent />
    </ProtectedRoute>
  );
}
