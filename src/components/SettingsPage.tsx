import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  User,
  Bell,
  Palette,
  Shield,
  Grid3x3,
  Calendar,
  MapPin,
  Eye,
  EyeOff,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AnimatedThemeToggler } from "@/components/AnimatedThemeToggler";
import { LanguageSelector } from "@/components/LanguageSelector";
import type { ViewMode, FilterViewMode } from "@/types";

interface SettingsPageProps {
  profileCompleted: boolean;
  onOpenOnboarding: () => void;
  userEmail: string | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filterViewMode: FilterViewMode;
  setFilterViewMode: (mode: FilterViewMode) => void;
  isDarkMode: boolean;
  setIsDarkMode: (isDark: boolean) => void;
}

interface NotificationPreferences {
  emailNotifications: boolean;
  eventReminders: boolean;
  newEventAlerts: boolean;
}

interface PrivacyPreferences {
  profileVisibility: "public" | "private";
  dataSharing: boolean;
}

const NOTIFICATION_PREFS_KEY = "notificationPreferences";
const PRIVACY_PREFS_KEY = "privacyPreferences";

export function SettingsPage({
  profileCompleted,
  onOpenOnboarding,
  userEmail,
  viewMode,
  setViewMode,
  filterViewMode,
  setFilterViewMode,
  isDarkMode,
  setIsDarkMode,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") || "profile";
  
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() => {
    const saved = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    return saved
      ? JSON.parse(saved)
      : {
          emailNotifications: true,
          eventReminders: true,
          newEventAlerts: true,
        };
  });

  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPreferences>(() => {
    const saved = localStorage.getItem(PRIVACY_PREFS_KEY);
    return saved
      ? JSON.parse(saved)
      : {
          profileVisibility: "public",
          dataSharing: true,
        };
  });

  // Persist notification preferences
  useEffect(() => {
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notificationPrefs));
  }, [notificationPrefs]);

  // Persist privacy preferences
  useEffect(() => {
    localStorage.setItem(PRIVACY_PREFS_KEY, JSON.stringify(privacyPrefs));
  }, [privacyPrefs]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  const updateNotificationPref = (key: keyof NotificationPreferences, value: boolean) => {
    setNotificationPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const updatePrivacyPref = (key: keyof PrivacyPreferences, value: string | boolean) => {
    setPrivacyPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const profileTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.profile.title")}</CardTitle>
          <CardDescription>
            {t("settings.profile.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base font-medium">{t("settings.profile.status")}</Label>
              <p className="text-sm text-muted-foreground">
                {profileCompleted
                  ? t("settings.profile.statusComplete")
                  : t("settings.profile.statusIncomplete")}
              </p>
            </div>
            {profileCompleted && (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500" />
            )}
          </div>
          {userEmail && (
            <div className="space-y-2">
              <Label htmlFor="email-display">{t("settings.profile.email")}</Label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">{userEmail}</span>
              </div>
            </div>
          )}
          <Separator />
          <Button onClick={onOpenOnboarding} className="w-full">
            {profileCompleted ? t("settings.profile.editProfile") : t("settings.profile.completeProfile")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const notificationsTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.notifications.title")}</CardTitle>
          <CardDescription>
            {t("settings.notifications.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="email-notifications" className="text-base font-medium">
                {t("settings.notifications.emailNotifications")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.notifications.emailNotificationsDesc")}
              </p>
            </div>
            <Toggle
              id="email-notifications"
              pressed={notificationPrefs.emailNotifications}
              onPressedChange={(pressed) =>
                updateNotificationPref("emailNotifications", pressed)
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="event-reminders" className="text-base font-medium">
                {t("settings.notifications.eventReminders")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.notifications.eventRemindersDesc")}
              </p>
            </div>
            <Toggle
              id="event-reminders"
              pressed={notificationPrefs.eventReminders}
              onPressedChange={(pressed) =>
                updateNotificationPref("eventReminders", pressed)
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="new-event-alerts" className="text-base font-medium">
                {t("settings.notifications.newEventAlerts")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.notifications.newEventAlertsDesc")}
              </p>
            </div>
            <Toggle
              id="new-event-alerts"
              pressed={notificationPrefs.newEventAlerts}
              onPressedChange={(pressed) =>
                updateNotificationPref("newEventAlerts", pressed)
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const appearanceTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.theme")}</CardTitle>
          <CardDescription>{t("settings.appearance.themeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label className="text-base font-medium">{t("settings.appearance.colorTheme")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.appearance.colorThemeDesc")}
              </p>
            </div>
            <AnimatedThemeToggler />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.language")}</CardTitle>
          <CardDescription>{t("settings.appearance.languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label className="text-base font-medium">{t("settings.appearance.language")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.appearance.languageDescription")}
              </p>
            </div>
            <LanguageSelector />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.viewPreferences")}</CardTitle>
          <CardDescription>{t("settings.appearance.viewPreferencesDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="view-mode" className="text-base font-medium">
              {t("settings.appearance.defaultViewMode")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.appearance.defaultViewModeDesc")}
            </p>
            <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <SelectTrigger id="view-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">
                  <div className="flex items-center gap-2">
                    <Grid3x3 className="h-4 w-4" />
                    <span>{t("settings.appearance.grid")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="calendar">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>{t("settings.appearance.calendar")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="map">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <span>{t("settings.appearance.map")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-base font-medium">{t("settings.appearance.filterViewMode")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.appearance.filterViewModeDesc")}
            </p>
            <div className="flex gap-2">
              <Toggle
                pressed={filterViewMode === "visual"}
                onPressedChange={(pressed) => {
                  if (pressed) setFilterViewMode("visual");
                }}
                variant="outline"
                className="flex-1"
              >
                {t("settings.appearance.visual")}
              </Toggle>
              <Toggle
                pressed={filterViewMode === "json"}
                onPressedChange={(pressed) => {
                  if (pressed) setFilterViewMode("json");
                }}
                variant="outline"
                className="flex-1"
              >
                {t("settings.appearance.json")}
              </Toggle>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const privacyTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.privacy.title")}</CardTitle>
          <CardDescription>
            {t("settings.privacy.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="profile-visibility" className="text-base font-medium">
              {t("settings.privacy.profileVisibility")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.privacy.profileVisibilityDesc")}
            </p>
            <Select
              value={privacyPrefs.profileVisibility}
              onValueChange={(value) =>
                updatePrivacyPref("profileVisibility", value as "public" | "private")
              }
            >
              <SelectTrigger id="profile-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    <span>{t("settings.privacy.public")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="private">
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-4 w-4" />
                    <span>{t("settings.privacy.private")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="data-sharing" className="text-base font-medium">
                {t("settings.privacy.dataSharing")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.privacy.dataSharingDesc")}
              </p>
            </div>
            <Toggle
              id="data-sharing"
              pressed={privacyPrefs.dataSharing}
              onPressedChange={(pressed) => updatePrivacyPref("dataSharing", pressed)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.description")}
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={tabParam} onValueChange={handleTabChange} className="mt-8">
          <TabsList>
            <TabsTrigger value="profile">{t("settings.tabs.profile")}</TabsTrigger>
            <TabsTrigger value="notifications">{t("settings.tabs.notifications")}</TabsTrigger>
            <TabsTrigger value="appearance">{t("settings.tabs.appearance")}</TabsTrigger>
            <TabsTrigger value="privacy">{t("settings.tabs.privacy")}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-8">
            {profileTab}
          </TabsContent>
          <TabsContent value="notifications" className="mt-8">
            {notificationsTab}
          </TabsContent>
          <TabsContent value="appearance" className="mt-8">
            {appearanceTab}
          </TabsContent>
          <TabsContent value="privacy" className="mt-8">
            {privacyTab}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
