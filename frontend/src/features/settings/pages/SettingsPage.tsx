import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { ProfileTab } from "@/features/settings/components/ProfileTab";
import { NotificationsTab } from "@/features/settings/components/NotificationsTab";
import { AppearanceTab } from "@/features/settings/components/AppearanceTab";
import { PromoterProgramTab } from "@/features/settings/components/PromoterProgramTab";
import { SettingsSaveBar } from "@/features/settings/components/SettingsSaveBar";
import { useSettingsForm } from "@/features/settings/hooks/useSettingsForm";
import { useUserEmail } from "@/features/auth";
import { usePromoterState } from "@/features/posters";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { SETTINGS_TABS } from "@/shared/constants/routes";
import { Container, PageHeader, Stack } from "@/shared/layout";

export function SettingsPage() {
  const userEmail = useUserEmail();
  const promoter = usePromoterState();
  const settings = useSettingsForm();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const requestedTab = searchParams.get(QP.TAB) || SETTINGS_TABS.PROFILE;
  const tabParam =
    requestedTab === SETTINGS_TABS.PROMOTER && !promoter.isEnrolled
      ? SETTINGS_TABS.PROFILE
      : requestedTab;

  useEffect(() => {
    if (
      requestedTab === SETTINGS_TABS.PROMOTER &&
      !promoter.isEnrolled
    ) {
      setSearchParams(
        { [QP.TAB]: SETTINGS_TABS.PROFILE },
        { replace: true },
      );
    }
  }, [promoter.isEnrolled, requestedTab, setSearchParams]);

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
              {promoter.isEnrolled && (
                <TabsTrigger
                  value={SETTINGS_TABS.PROMOTER}
                  data-testid="settings-promoter-tab"
                >
                  {t("settings.tabs.promoter")}
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value={SETTINGS_TABS.PROFILE}>
              <ProfileTab
                userEmail={userEmail}
                profile={settings.values.profile}
                avatarPreviewUrl={settings.avatarPreviewUrl}
                disabled={settings.isSaving}
                onProfileChange={settings.updateProfile}
                onAvatarChange={settings.selectAvatar}
              />
            </TabsContent>
            <TabsContent value={SETTINGS_TABS.NOTIFICATIONS}>
              <NotificationsTab
                preferences={settings.values.notifications}
                isLoading={settings.isLoading}
                isError={settings.isNotificationError}
                disabled={settings.isSaving}
                onRetry={() => void settings.retryNotifications()}
                onPreferenceChange={settings.updateNotification}
              />
            </TabsContent>
            <TabsContent value={SETTINGS_TABS.APPEARANCE}>
              <AppearanceTab
                appearance={settings.values.appearance}
                disabled={settings.isSaving}
                onAppearanceChange={settings.updateAppearance}
              />
            </TabsContent>
            {promoter.isEnrolled && (
              <TabsContent value={SETTINGS_TABS.PROMOTER}>
                <PromoterProgramTab />
              </TabsContent>
            )}
          </Stack>
        </Tabs>
      </Stack>
      {settings.isDirty && (
        <SettingsSaveBar
          isSaving={settings.isSaving}
          onCancel={settings.cancel}
          onSave={settings.save}
        />
      )}
    </Container>
  );
}
