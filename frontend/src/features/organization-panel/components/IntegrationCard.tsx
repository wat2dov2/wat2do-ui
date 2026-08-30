import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { Integration } from "@/features/organization-panel/hooks/useIntegrations";
import type { IntegrationPlatform } from "@/features/organization-panel/api/integrations.api";

interface IntegrationCardProps {
  integration: Integration | undefined;
  platform: IntegrationPlatform;
  icon: React.ReactNode;
  iconBgClassName: string;
  titleKey: string;
  descriptionKey: string;
  onConnect: () => void;
  onDisconnect: () => void;
  disabled?: boolean;
}

export function IntegrationCard({
  integration,
  platform,
  icon,
  iconBgClassName,
  titleKey,
  descriptionKey,
  onConnect,
  onDisconnect,
  disabled,
}: IntegrationCardProps) {
  const { t } = useTranslation();

  const formatLastSync = (isoString?: string) => {
    if (!isoString) return "";
    return formatRelativeTime(isoString, t);
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${iconBgClassName}`}
          >
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground">{t(titleKey)}</h3>
              {integration?.connected && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                  <span className="size-1.5 bg-green-500 rounded-full" />
                  {t("integrations.connected")}
                </span>
              )}
            </div>
            {integration?.connected ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  {integration.name}
                  {platform === "facebook" && integration.connectionType === "group" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({t("integrations.groupChat")})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("integrations.lastSync")}: {formatLastSync(integration.lastSync)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {integration?.connected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onMouseDown={onConnect}
                disabled={disabled}
              >
                {t("integrations.manage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onMouseDown={onDisconnect}
                disabled={disabled}
              >
                {t("integrations.disconnect")}
              </Button>
            </>
          ) : (
            <Button onMouseDown={onConnect} disabled={disabled}>
              {t("integrations.connect")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
