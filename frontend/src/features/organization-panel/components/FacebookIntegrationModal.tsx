import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { PlatformConnectModal, type PlatformConnectConfig, type PlatformConnectModalProps } from "./PlatformConnectModal";

const facebookConfig: PlatformConnectConfig = {
  titleKey: "integrations.connectFacebook",
  step1DescKey: "integrations.facebookStep1Desc",
  step2DescKey: "integrations.facebookStep2Desc",
  connectLabelKey: "integrations.step1ConnectAccount",
  connectDescKey: "integrations.facebookConnectDescription",
  authorizedTextKey: "integrations.accountConnected",
  authorizeTextKey: "integrations.connectWithFacebook",
  selectLabelKey: "integrations.step2SelectDestination",
  primaryFieldLabelKey: "integrations.facebookPage",
  primaryPlaceholderKey: "integrations.selectPage",
  noteKey: "integrations.facebookPageAutoPublishNote",
};

export function FacebookIntegrationModal({
  servers,
  onSelectPrimary,
  ...rest
}: Omit<PlatformConnectModalProps, "config">) {
  const { t } = useTranslation();
  const [connectionType, setConnectionType] = useState<"page" | "group">("page");

  const filteredTargets = servers.filter((target) =>
    connectionType === "page"
      ? target.id.startsWith("page:")
      : target.id.startsWith("group:")
  );

  const handleConnectionTypeChange = (ct: "page" | "group") => {
    setConnectionType(ct);
    onSelectPrimary("");
  };

  const pageGroupToggle = (
    <Field>
      <FieldLabel className="text-sm text-muted-foreground">
        {t("integrations.connectionType")}
      </FieldLabel>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={connectionType === "page" ? "primary" : "secondary"}
          className="flex-1"
          onMouseDown={() => handleConnectionTypeChange("page")}
        >
          {t("integrations.facebookPage")}
        </Button>
        <Button
          type="button"
          variant={connectionType === "group" ? "primary" : "secondary"}
          className="flex-1"
          onMouseDown={() => handleConnectionTypeChange("group")}
        >
          {t("integrations.facebookGroup")}
        </Button>
      </div>
    </Field>
  );

  return (
    <PlatformConnectModal
      {...rest}
      servers={servers}
      onSelectPrimary={onSelectPrimary}
      config={facebookConfig}
      extraSelectContent={pageGroupToggle}
      filteredServers={filteredTargets}
      primaryFieldLabelOverride={
        connectionType === "page"
          ? t("integrations.facebookPage")
          : t("integrations.facebookGroup")
      }
      primaryPlaceholderOverride={
        connectionType === "page"
          ? t("integrations.selectPage")
          : t("integrations.selectGroup")
      }
      noteOverride={
        connectionType === "page"
          ? t("integrations.facebookPageAutoPublishNote")
          : t("integrations.facebookGroupAutoImportNote")
      }
    />
  );
}
