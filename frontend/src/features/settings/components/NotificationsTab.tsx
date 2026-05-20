/**
 * NotificationsTab Component
 * UI component for notification preferences
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Separator } from "@/shared/ui/separator";
import { useNotifications } from "@/features/settings/hooks/useNotifications";

export function NotificationsTab() {
  const { t } = useTranslation();
  const { preferences, updatePreference } = useNotifications();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Label
                htmlFor="email-notifications"
                className="text-base font-medium"
              >
                {t("settings.notifications.emailNotifications")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.notifications.emailNotificationsDesc")}
              </p>
            </div>
            <Switch
              id="email-notifications"
              checked={preferences.emailNotifications}
              onCheckedChange={(checked) =>
                updatePreference("emailNotifications", checked)
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
            <Switch
              id="event-reminders"
              checked={preferences.eventReminders}
              onCheckedChange={(checked) =>
                updatePreference("eventReminders", checked)
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
            <Switch
              id="new-event-alerts"
              checked={preferences.newEventAlerts}
              onCheckedChange={(checked) =>
                updatePreference("newEventAlerts", checked)
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
