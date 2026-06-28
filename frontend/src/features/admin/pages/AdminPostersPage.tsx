import { lazy, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);

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
