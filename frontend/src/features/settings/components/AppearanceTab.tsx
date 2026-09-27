import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { LanguageSelector } from "@/shared/ui/language-selector";
import type { AppearanceSettingsDraft } from "@/features/settings/hooks/useSettingsForm";

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
    </div>
  );
}
