import { lazy } from "react";
import {
  PostersPageContent,
  QRCodeDetailsModal,
  GenerateQRAssetsWizard,
} from "@/features/posters";
import { useEventsStore } from "@/features/events/store/events.store";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

interface ClubPanelPostersPageProps {
  onBack: () => void;
}

export function ClubPanelPostersPage({ onBack }: ClubPanelPostersPageProps) {
  const events = useEventsStore((s) => s.events);
  const userEmail = useUserEmail() || "";

  return (
    <PostersPageContent
      events={events}
      onBack={onBack}
      userEmail={userEmail}
      ScanMapComponent={QRScanMap}
      DetailsModalComponent={QRCodeDetailsModal}
      AssetWizardComponent={GenerateQRAssetsWizard}
    />
  );
}
