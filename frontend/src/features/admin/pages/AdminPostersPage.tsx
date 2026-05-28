import { lazy, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useEventsStore } from "@/features/events";
import { useUserEmail } from "@/features/auth";
import { ROUTES } from "@/shared/constants/routes";
import {
  PostersPageContent,
  QRCodeDetailsModal,
  GenerateQRAssetsWizard,
} from "@/features/posters";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

export function AdminPostersPage() {
  const events = useEventsStore((s) => s.events);
  const userEmail = useUserEmail();
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate(ROUTES.ADMIN), [navigate]);

  return (
    <PostersPageContent
      events={events}
      onBack={onBack}
      userEmail={userEmail || ""}
      ScanMapComponent={QRScanMap}
      DetailsModalComponent={QRCodeDetailsModal}
      AssetWizardComponent={GenerateQRAssetsWizard}
    />
  );
}
