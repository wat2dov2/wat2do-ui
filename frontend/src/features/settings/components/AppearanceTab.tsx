/**
 * AppearanceTab Component
 * UI component for appearance preferences
 */

import { useTranslation } from "react-i18next";
import { Grid3x3, Calendar, MapPin } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Toggle } from "@/shared/ui/toggle";
import { Separator } from "@/shared/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { useUIStore } from "@/shared/store/ui.store";
import type { ViewMode } from "@/shared/types";

export function AppearanceTab() {
  const { t } = useTranslation();
  // Subscribe directly to avoid a middleman prop-drill through SettingsPage.
  // Each selector is narrow so only the consuming slot re-renders.
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const filterViewMode = useUIStore((s) => s.filterViewMode);
  const setFilterViewMode = useUIStore((s) => s.setFilterViewMode);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label className="text-base font-medium">
                {t("settings.appearance.colorTheme")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.appearance.colorThemeDesc")}
              </p>
            </div>
            <AnimatedThemeToggler />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label className="text-base font-medium">
                {t("settings.appearance.language")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.appearance.languageDescription")}
              </p>
            </div>
            <LanguageSelector />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="view-mode" className="text-base font-medium">
              {t("settings.appearance.defaultViewMode")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.appearance.defaultViewModeDesc")}
            </p>
            <Select
              value={viewMode}
              onValueChange={(value) => setViewMode(value as ViewMode)}
            >
              <SelectTrigger id="view-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">
                  <div className="flex items-center gap-2">
                    <Grid3x3 className="size-4" />
                    <span>{t("settings.appearance.grid")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="calendar">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4" />
                    <span>{t("settings.appearance.calendar")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="map">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4" />
                    <span>{t("settings.appearance.map")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-base font-medium">
              {t("settings.appearance.filterViewMode")}
            </Label>
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
}
