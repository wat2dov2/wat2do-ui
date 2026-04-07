/**
 * SettingsPage
 * Orchestration layer for settings feature
 * 
 * This page composes the settings tabs and manages routing between them.
 * All business logic is delegated to hooks and components.
 */

import React from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { ProfileTab } from "@/features/settings/components/ProfileTab";
import { NotificationsTab } from "@/features/settings/components/NotificationsTab";
import { AppearanceTab } from "@/features/settings/components/AppearanceTab";
import { PrivacyTab } from "@/features/settings/components/PrivacyTab";
import { useAppContext } from "@/contexts/AppContext";
import { QP } from "@/shared/constants/queryParams";

export function SettingsPage() {
  const { userEmail, viewMode, setViewMode, filterViewMode, setFilterViewMode } =
    useAppContext();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get(QP.TAB) || "profile";

  const handleTabChange = (value: string) => {
    setSearchParams({ [QP.TAB]: value });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t("navigation.settings")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={tabParam} onValueChange={handleTabChange} className="mt-8">
          <TabsList className="h-8">
            <TabsTrigger value="profile">{t("settings.tabs.profile")}</TabsTrigger>
            <TabsTrigger value="notifications">
              {t("settings.tabs.notifications")}
            </TabsTrigger>
            <TabsTrigger value="appearance">
              {t("settings.tabs.appearance")}
            </TabsTrigger>
            <TabsTrigger value="privacy">{t("settings.tabs.privacy")}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-8">
            <ProfileTab userEmail={userEmail} />
          </TabsContent>
          <TabsContent value="notifications" className="mt-8">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value="appearance" className="mt-8">
            <AppearanceTab
              viewMode={viewMode}
              setViewMode={setViewMode}
              filterViewMode={filterViewMode}
              setFilterViewMode={setFilterViewMode}
            />
          </TabsContent>
          <TabsContent value="privacy" className="mt-8">
            <PrivacyTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
