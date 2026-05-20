import { lazy, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useEventsStore } from "@/features/events/store/events.store";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { ROUTES } from "@/shared/constants/routes";
import { PostersPageContent } from "@/shared/components/PostersPageContent";
import { QRCodeDetailsModal, GenerateQRAssetsWizard } from "@/features/qrcode";

const QRScanMap = lazy(() => import("@/features/qrcode/components/QRScanMap").then(module => ({ default: module.QRScanMap })));

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
