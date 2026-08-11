"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { SettingsPage as SettingsPageContent } from "@/features/settings/pages/SettingsPage";

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsPageContent />
    </ProtectedRoute>
  );
}
