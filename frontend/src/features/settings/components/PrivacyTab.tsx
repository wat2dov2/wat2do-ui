/**
 * PrivacyTab Component
 * UI component for privacy preferences
 */

import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Separator } from "@/shared/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { usePrivacy } from "@/features/settings/hooks/usePrivacy";

export function PrivacyTab() {
  const { t } = useTranslation();
  const { preferences, updatePreference } = usePrivacy();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="profile-visibility" className="text-base font-medium">
              {t("settings.privacy.profileVisibility")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.privacy.profileVisibilityDesc")}
            </p>
            <Select
              value={preferences.profileVisibility}
              onValueChange={(value) =>
                updatePreference("profileVisibility", value as "public" | "private")
              }
            >
              <SelectTrigger id="profile-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  <div className="flex items-center gap-2">
                    <Eye className="size-4" />
                    <span>{t("settings.privacy.public")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="private">
                  <div className="flex items-center gap-2">
                    <EyeOff className="size-4" />
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
            <Switch
              id="data-sharing"
              checked={preferences.dataSharing}
              onCheckedChange={(checked) =>
                updatePreference("dataSharing", checked)
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
