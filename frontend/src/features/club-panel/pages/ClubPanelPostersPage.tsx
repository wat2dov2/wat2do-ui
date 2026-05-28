import { lazy } from "react";
import {
  PostersPageContent,
  QRCodeDetailsModal,
  GenerateQRAssetsWizard,
} from "@/features/posters";
import type { Event } from "@/shared/types";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

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
