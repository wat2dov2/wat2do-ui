import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { ProfileTab } from "@/features/settings/components/ProfileTab";
import { NotificationsTab } from "@/features/settings/components/NotificationsTab";
import { AppearanceTab } from "@/features/settings/components/AppearanceTab";
import { PromoterProgramTab } from "@/features/settings/components/PromoterProgramTab";
import { useUserEmail } from "@/features/auth";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { SETTINGS_TABS } from "@/shared/constants/routes";
import { Container, PageHeader, Stack } from "@/shared/layout";

export function SettingsPage() {
  const userEmail = useUserEmail();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const tabParam = searchParams.get(QP.TAB) || SETTINGS_TABS.PROFILE;

  const handleTabChange = (value: string) => {
    setSearchParams({ [QP.TAB]: value });
  };

  return (
    <Container size="md">
      <Stack gap={8}>
        <PageHeader
          title={t("navigation.settings")}
          description={t("settings.description")}
        />
        <Tabs value={tabParam} onValueChange={handleTabChange}>
          <Stack gap={8}>
            <TabsList>
              <TabsTrigger value={SETTINGS_TABS.PROFILE}>
                {t("settings.tabs.profile")}
              </TabsTrigger>
              <TabsTrigger value={SETTINGS_TABS.NOTIFICATIONS}>
                {t("settings.tabs.notifications")}
              </TabsTrigger>
              <TabsTrigger value={SETTINGS_TABS.APPEARANCE}>
                {t("settings.tabs.appearance")}
              </TabsTrigger>
              <TabsTrigger
                value={SETTINGS_TABS.PROMOTER}
                data-testid="settings-promoter-tab"
              >
                {t("settings.tabs.promoter")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value={SETTINGS_TABS.PROFILE}>
              <ProfileTab userEmail={userEmail} />
            </TabsContent>
            <TabsContent value={SETTINGS_TABS.NOTIFICATIONS}>
              <NotificationsTab />
            </TabsContent>
            <TabsContent value={SETTINGS_TABS.APPEARANCE}>
              <AppearanceTab />
            </TabsContent>
            <TabsContent value={SETTINGS_TABS.PROMOTER}>
              <PromoterProgramTab />
            </TabsContent>
          </Stack>
        </Tabs>
      </Stack>
    </Container>
  );
}
