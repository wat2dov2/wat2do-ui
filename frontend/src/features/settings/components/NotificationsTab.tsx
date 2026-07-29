import { useTranslation } from "react-i18next";
import type {
  NotificationPreferenceKey,
  NotificationPreferences,
} from "@/features/settings/api/notificationPreferences.api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Separator } from "@/shared/ui/separator";
import { Switch } from "@/shared/ui/switch";

interface NotificationsTabProps {
  preferences: NotificationPreferences;
  isLoading: boolean;
  isError: boolean;
  disabled: boolean;
  onRetry: () => void;
  onPreferenceChange: (
    key: NotificationPreferenceKey,
    enabled: boolean,
  ) => void;
}

export function NotificationsTab({
  preferences,
  isLoading,
  isError,
  disabled,
  onRetry,
  onPreferenceChange,
}: NotificationsTabProps) {
  const { t } = useTranslation();

  if (isError) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">
            {t("settings.notifications.loadFailed")}
          </p>
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t("settings.notifications.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const controlsDisabled = isLoading || disabled;
  return (
    <Card>
      <CardContent className="space-y-6">
        <PreferenceToggle
          id="morning-email"
          label={t("settings.notifications.morningEmail")}
          description={t("settings.notifications.morningEmailDesc")}
          checked={preferences.morningEmail}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("morningEmail", checked)
          }
        />
        <Separator />
        <PreferenceToggle
          id="event-reminder"
          label={t("settings.notifications.eventReminder")}
          description={t("settings.notifications.eventReminderDesc")}
          checked={preferences.eventReminder}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("eventReminder", checked)
          }
        />
        <Separator />
        <PreferenceToggle
          id="event-change"
          label={t("settings.notifications.eventChange")}
          description={t("settings.notifications.eventChangeDesc")}
          checked={preferences.eventChange}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("eventChange", checked)
          }
        />
      </CardContent>
    </Card>
  );
}

function PreferenceToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 space-y-1">
        <Label htmlFor={id} className="text-base font-medium">
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
