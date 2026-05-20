import { lazy } from "react";
import { PostersPageContent } from "@/shared/components/PostersPageContent";
import { QRCodeDetailsModal, GenerateQRAssetsWizard } from "@/features/qrcode";
import type { Event } from "@/shared/types";

const QRScanMap = lazy(() => import("@/features/qrcode/components/QRScanMap").then(module => ({ default: module.QRScanMap })));

interface ClubPanelPostersPageProps {
  events: Event[];
  onBack: () => void;
  userEmail: string;
}

export function ClubPanelPostersPage({ events, onBack, userEmail }: ClubPanelPostersPageProps) {
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
