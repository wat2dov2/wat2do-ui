import { useTranslation } from "react-i18next";
import { Grid3x3, Calendar, MapPin } from "@/shared/ui/doodle-icons";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { LanguageSelector } from "@/shared/ui/language-selector";
import type { AppearanceSettingsDraft } from "@/features/settings/hooks/useSettingsForm";
import type { ViewMode } from "@/shared/types";

interface AppearanceTabProps {
  appearance: AppearanceSettingsDraft;
  disabled: boolean;
  onAppearanceChange: (updates: Partial<AppearanceSettingsDraft>) => void;
}

export function AppearanceTab({
  appearance,
  disabled,
  onAppearanceChange,
}: AppearanceTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
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
            <LanguageSelector
              value={appearance.language}
              disabled={disabled}
              onValueChange={(language) =>
                onAppearanceChange({ language })
              }
            />
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
              value={appearance.viewMode}
              disabled={disabled}
              onValueChange={(value) =>
                onAppearanceChange({ viewMode: value as ViewMode })
              }
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
        </CardContent>
      </Card>
    </div>
  );
}
