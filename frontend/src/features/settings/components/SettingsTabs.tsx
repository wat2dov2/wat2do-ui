import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { ProfileTab } from "@/features/settings/components/ProfileTab";
import { NotificationsTab } from "@/features/settings/components/NotificationsTab";
import { AppearanceTab } from "@/features/settings/components/AppearanceTab";
import { PromoterProgramTab } from "@/features/settings/components/PromoterProgramTab";
import { SaveBar } from "@/shared/ui/save-bar";
import type { SettingsForm } from "@/features/settings/hooks/useSettingsForm";
import { usePromoterState } from "@/features/posters";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { SETTINGS_TABS } from "@/shared/constants/routes";

const SETTINGS_TAB_VALUES = Object.values(SETTINGS_TABS);
import { Stack } from "@/shared/layout";

/**
 * The visitor's settings, one tab each, as the profile page shows them. The
 * page owns the settings form, since its header edits the photo in it.
 */
export function SettingsTabs({ settings }: { settings: SettingsForm }) {
  const promoter = usePromoterState();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  // The profile's tab parameter names a settings tab here, or Settings as a whole, which opens on Profile.
  const tabValue = searchParams.get(QP.TAB);
  const requestedTab = SETTINGS_TAB_VALUES.find((tab) => tab === tabValue) ?? SETTINGS_TABS.PROFILE;
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
    <>
      <Tabs value={tabParam} onValueChange={handleTabChange}>
        <Stack gap={6}>
          <TabsList aria-label={t("profile.settings")}>
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
              profile={settings.values.profile}
              isLoading={settings.isProfileLoading}
              disabled={settings.isSaving}
              onProfileChange={settings.updateProfile}
            />
          </TabsContent>
          <TabsContent value={SETTINGS_TABS.NOTIFICATIONS}>
            <NotificationsTab
              preferences={settings.values.notifications}
              isLoading={settings.isNotificationLoading}
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
      {settings.isDirty && (
        <SaveBar
          isSaving={settings.isSaving}
          onDiscard={settings.cancel}
          onSave={settings.save}
        />
      )}
    </>
  );
}
