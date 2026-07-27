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

export function SettingsPage() {
  const userEmail = useUserEmail();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const tabParam = searchParams.get(QP.TAB) || SETTINGS_TABS.PROFILE;

  const handleTabChange = (value: string) => {
    setSearchParams({ [QP.TAB]: value });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            {t("navigation.settings")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={tabParam} onValueChange={handleTabChange} className="mt-8">
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
          <TabsContent value={SETTINGS_TABS.PROFILE} className="mt-8">
            <ProfileTab userEmail={userEmail} />
          </TabsContent>
          <TabsContent value={SETTINGS_TABS.NOTIFICATIONS} className="mt-8">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value={SETTINGS_TABS.APPEARANCE} className="mt-8">
            <AppearanceTab />
          </TabsContent>
          <TabsContent value={SETTINGS_TABS.PROMOTER} className="mt-8">
            <PromoterProgramTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
