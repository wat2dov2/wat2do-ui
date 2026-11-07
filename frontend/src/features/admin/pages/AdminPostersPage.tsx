import { lazy, useState } from "react";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { useTranslation } from "react-i18next";
import { useUserEmail } from "@/features/auth";
import { AdminPayoutsPanel } from "@/features/admin/components/posters/AdminPayoutsPanel";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import {
  PostersPageContent,
  QRCodeDetailsModal,
  GenerateQRAssetsWizard,
} from "@/features/posters";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { Coins } from "lucide-react";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

export function AdminPostersPage() {
  const { t } = useTranslation();
  const userEmail = useUserEmail();
  const [activeTab, setActiveTab] = useState<"posters" | "payouts">("posters");
  const showingPosters = activeTab === "posters";

  return (
    <Stack gap={5}>
      <PageShellHeader
        route={ROUTES.ADMIN_POSTERS}
        icon={showingPosters ? undefined : Coins}
        title={showingPosters ? undefined : t("admin.posterPayouts.title")}
        description={showingPosters ? undefined : t("admin.posterPayouts.description")}
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "posters" | "payouts")}
      >
        <TabsList aria-label={t("admin.posterPayouts.tabs.label")}>
          <TabsTrigger value="posters" data-testid="admin-posters-tab">
            {t("admin.posterPayouts.tabs.posters")}
          </TabsTrigger>
          <TabsTrigger value="payouts" data-testid="admin-payouts-tab">
            {t("admin.posterPayouts.tabs.payouts")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posters" className="mt-5">
          <PostersPageContent
            school={null}
            userEmail={userEmail || ""}
            ScanMapComponent={QRScanMap}
            DetailsModalComponent={QRCodeDetailsModal}
            AssetWizardComponent={GenerateQRAssetsWizard}
          />
        </TabsContent>

        <TabsContent value="payouts" className="mt-5">
          <AdminPayoutsPanel />
        </TabsContent>
      </Tabs>
    </Stack>
  );
}
