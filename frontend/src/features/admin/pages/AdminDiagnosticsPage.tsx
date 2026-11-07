import { useTranslation } from "react-i18next";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { DiscoveryQueries } from "@/features/admin/components/DiscoveryQueries";
import { DiagnosticsLogs } from "@/features/admin/components/DiagnosticsLogs";
import { IngestionLatency } from "@/features/admin/components/IngestionLatency";


export function AdminDiagnosticsPage() {
  const { t } = useTranslation();

  return (
    <Stack gap={6}>
      <PageShellHeader route={ROUTES.ADMIN_DIAGNOSTICS} />

      <Tabs defaultValue="scraping">
        <Stack gap={5}>
          <TabsList aria-label={t("admin.diagnostics.tabs.label")}>
            <TabsTrigger value="queries">
              {t("admin.diagnostics.queries.title")}
            </TabsTrigger>
            <TabsTrigger value="endpoints">
              {t("admin.diagnostics.tabs.endpoints")}
            </TabsTrigger>
            <TabsTrigger value="browser">
              {t("admin.diagnostics.tabs.browser")}
            </TabsTrigger>
            <TabsTrigger value="scraping">
              {t("admin.diagnostics.tabs.scraping")}
            </TabsTrigger>
            <TabsTrigger value="latency">
              {t("admin.diagnostics.tabs.latency")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queries"><DiscoveryQueries /></TabsContent>
          <TabsContent value="endpoints" />

          <TabsContent value="scraping">
            <DiagnosticsLogs />
          </TabsContent>
          <TabsContent value="browser">
            <DiagnosticsLogs browserWorker />
          </TabsContent>
          <TabsContent value="latency">
            <IngestionLatency />
          </TabsContent>
        </Stack>
      </Tabs>
    </Stack>
  );
}
