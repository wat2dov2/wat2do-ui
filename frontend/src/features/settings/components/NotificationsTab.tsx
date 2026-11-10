import { useTranslation } from "react-i18next";
import type {
  NotificationPreferenceKey,
  NotificationPreferences,
} from "@/features/settings/api/notificationPreferences.api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Separator } from "@/shared/ui/separator";
import { SwitchField } from "@/shared/ui/switch-field";

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
          <Button type="button" variant="outline" onClick={onRetry}>
            {t("settings.notifications.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const controlsDisabled = isLoading || disabled;
  return (
    <Card>
      <CardContent className="space-y-6" aria-busy={isLoading}>
        <SwitchField
          id="morning-email"
          label={t("settings.notifications.morningEmail")}
          description={t("settings.notifications.morningEmailDesc")}
          checked={preferences.morningEmail}
          loading={isLoading}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("morningEmail", checked)
          }
        />
        <Separator />
        <SwitchField
          id="event-reminder"
          label={t("settings.notifications.eventReminder")}
          description={t("settings.notifications.eventReminderDesc")}
          checked={preferences.eventReminder}
          loading={isLoading}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("eventReminder", checked)
          }
        />
        <Separator />
        <SwitchField
          id="event-change"
          label={t("settings.notifications.eventChange")}
          description={t("settings.notifications.eventChangeDesc")}
          checked={preferences.eventChange}
          loading={isLoading}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onPreferenceChange("eventChange", checked)
          }
        />
      </CardContent>
    </Card>
  );
}
