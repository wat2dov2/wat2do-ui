import { useTranslation } from "react-i18next";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { Container, Stack } from "@/shared/layout";
import { Settings } from "@/shared/ui/doodle-icons";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { DiscoveryQueries } from "@/features/admin/components/DiscoveryQueries";
import { DiagnosticsLogs } from "@/features/admin/components/DiagnosticsLogs";

interface AdminDiagnosticsPageProps {
  onBack: () => void;
}

export function AdminDiagnosticsPage({ onBack }: AdminDiagnosticsPageProps) {
  const { t } = useTranslation();

  return (
    <Container size="lg">
      <Stack gap={6}>
        <AdminPageHeader
          icon={Settings}
          title={t("admin.diagnostics.title")}
          description={t("admin.diagnostics.description")}
          onBack={onBack}
        />

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
            </TabsList>

            <TabsContent value="queries"><DiscoveryQueries /></TabsContent>
            <TabsContent value="endpoints" />

            <TabsContent value="scraping">
              <DiagnosticsLogs />
            </TabsContent>
            <TabsContent value="browser">
              <DiagnosticsLogs browserWorker />
            </TabsContent>
          </Stack>
        </Tabs>
      </Stack>
    </Container>
  );
}
