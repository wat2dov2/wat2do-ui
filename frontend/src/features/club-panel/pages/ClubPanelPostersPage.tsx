import { lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  PostersPageContent,
  QRCodeDetailsModal,
  GenerateQRAssetsWizard,
} from "@/features/posters";
import { useEventsStore } from "@/features/events/store/events.store";
import { useUserEmail } from "@/features/auth/hooks/useAuthState";
import { PageHeader, Stack } from "@/shared/layout";
import { Megaphone } from "@/shared/ui/doodle-icons";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

interface ClubPanelPostersPageProps {
  onBack: () => void;
}

export function ClubPanelPostersPage({ onBack }: ClubPanelPostersPageProps) {
  const { t } = useTranslation();
  const school = useEventsStore((s) => s.schoolFilter);
  const userEmail = useUserEmail() || "";

  return (
    <Stack gap={5}>
      <PageHeader
        back={{
          label: t("clubPanel.backToPanel"),
          onClick: onBack,
        }}
        icon={Megaphone}
        title={t("admin.qrAssets.title")}
        description={t("admin.qrAssets.description")}
      />
      <PostersPageContent
        school={school}
        userEmail={userEmail}
        ScanMapComponent={QRScanMap}
        DetailsModalComponent={QRCodeDetailsModal}
        AssetWizardComponent={GenerateQRAssetsWizard}
      />
    </Stack>
  );
}
