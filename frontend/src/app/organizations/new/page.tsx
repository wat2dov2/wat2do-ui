"use client";

import { ProtectedRoute } from "@/app/ProtectedRoute";
import { CreateOrganizationPage as CreateOrganizationPageContent } from "@/features/organizations/pages/CreateOrganizationPage";

export default function CreateOrganizationPage() {
  return (
    <ProtectedRoute>
      <CreateOrganizationPageContent />
    </ProtectedRoute>
  );
}
