import { lazy, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useEventsStore } from "@/features/events";
import { useUserEmail } from "@/features/auth";
import { AdminPayoutsPanel } from "@/features/admin/components/posters/AdminPayoutsPanel";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
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
import { Coins, Megaphone } from "@/shared/ui/doodle-icons";

const QRScanMap = lazy(() =>
  import("@/features/posters").then((module) => ({ default: module.QRScanMap })),
);

export function AdminPostersPage() {
  const { t } = useTranslation();
  const events = useEventsStore((s) => s.events);
  const userEmail = useUserEmail();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"posters" | "payouts">("posters");
  const onBack = useCallback(() => router.push(ROUTES.ADMIN), [router]);
  const showingPosters = activeTab === "posters";

  return (
    <Stack gap={5}>
      <PageHeader
        back={{ label: t("admin.backToDashboard"), onClick: onBack }}
        icon={showingPosters ? Megaphone : Coins}
        title={
          showingPosters
            ? t("admin.qrAssets.title")
            : t("admin.posterPayouts.title")
        }
        description={
          showingPosters
            ? t("admin.qrAssets.description")
            : t("admin.posterPayouts.description")
        }
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
            events={events}
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
