import { useTranslation } from "react-i18next";
import { useNotifications } from "@/features/settings/hooks/useNotifications";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Separator } from "@/shared/ui/separator";
import { Switch } from "@/shared/ui/switch";

export function NotificationsTab() {
  const { t } = useTranslation();
  const {
    preferences,
    isLoading,
    isError,
    isSaving,
    retry,
    updatePreference,
  } = useNotifications();

  if (isError) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">
            {t("settings.notifications.loadFailed")}
          </p>
          <Button type="button" variant="secondary" onClick={() => void retry()}>
            {t("settings.notifications.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const disabled = isLoading || isSaving || !preferences;
  return (
    <Card>
      <CardContent className="space-y-6">
        <PreferenceToggle
          id="morning-email"
          label={t("settings.notifications.morningEmail")}
          description={t("settings.notifications.morningEmailDesc")}
          checked={preferences?.morningEmail ?? false}
          disabled={disabled}
          onCheckedChange={(checked) =>
            updatePreference("morningEmail", checked)
          }
        />
        <Separator />
        <PreferenceToggle
          id="event-reminder"
          label={t("settings.notifications.eventReminder")}
          description={t("settings.notifications.eventReminderDesc")}
          checked={preferences?.eventReminder ?? false}
          disabled={disabled}
          onCheckedChange={(checked) =>
            updatePreference("eventReminder", checked)
          }
        />
        <Separator />
        <PreferenceToggle
          id="event-change"
          label={t("settings.notifications.eventChange")}
          description={t("settings.notifications.eventChangeDesc")}
          checked={preferences?.eventChange ?? false}
          disabled={disabled}
          onCheckedChange={(checked) => updatePreference("eventChange", checked)}
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
