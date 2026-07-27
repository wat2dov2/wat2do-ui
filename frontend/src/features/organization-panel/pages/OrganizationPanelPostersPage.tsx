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

interface OrganizationPanelPostersPageProps {
  onBack: () => void;
}

export function OrganizationPanelPostersPage({ onBack }: OrganizationPanelPostersPageProps) {
  const { t } = useTranslation();
  const events = useEventsStore((s) => s.events);
  const userEmail = useUserEmail() || "";

  return (
    <Stack gap={5}>
      <PageHeader
        back={{
          label: t("organizationPanel.backToPanel"),
          onClick: onBack,
        }}
        icon={Megaphone}
        title={t("admin.qrAssets.title")}
        description={t("admin.qrAssets.description")}
      />
      <PostersPageContent
        events={events}
        userEmail={userEmail}
        ScanMapComponent={QRScanMap}
        DetailsModalComponent={QRCodeDetailsModal}
        AssetWizardComponent={GenerateQRAssetsWizard}
      />
    </Stack>
  );
}
