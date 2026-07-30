import { useTranslation } from "react-i18next";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { Container, Stack } from "@/shared/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Settings } from "@/shared/ui/doodle-icons";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";

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
              <TabsTrigger value="endpoints">
                {t("admin.diagnostics.tabs.endpoints")}
              </TabsTrigger>
              <TabsTrigger value="scraping">
                {t("admin.diagnostics.tabs.scraping")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="endpoints" />

            <TabsContent value="scraping">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{t("admin.diagnostics.automateLogs.title")}</h2>
                  </CardTitle>
                  <CardDescription>
                    {t("admin.diagnostics.automateLogs.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-4 font-mono text-sm text-muted-foreground">
                    {t("admin.diagnostics.automateLogs.placeholder")}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
          </Stack>
        </Tabs>
      </Stack>
    </Container>
  );
}
