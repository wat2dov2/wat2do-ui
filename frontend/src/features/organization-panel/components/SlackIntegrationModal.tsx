import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Field, FieldLabel } from "@/shared/ui/field";
import { PlatformConnectModal, type PlatformConnectConfig } from "./PlatformConnectModal";
import type { IntegrationServerOption, IntegrationChannelOption } from "@/features/organization-panel/api/integrations.api";

const slackConfig: PlatformConnectConfig = {
  titleKey: "integrations.connectSlack",
  step1DescKey: "integrations.slackStep1Desc",
  step2DescKey: "integrations.slackStep2Desc",
  connectLabelKey: "integrations.step1AddApp",
  connectDescKey: "integrations.addSlackAppDescription",
  authorizedTextKey: "integrations.appAdded",
  authorizeTextKey: "integrations.addToSlack",
  brandColorClass: "bg-purple-600 hover:bg-purple-700",
  selectLabelKey: "integrations.step2SelectChannel",
  primaryFieldLabelKey: "integrations.workspace",
  primaryPlaceholderKey: "integrations.selectWorkspace",
  noteKey: "integrations.slackAutoPublishNote",
};

interface SlackIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: "connect" | "select";
  authorized: boolean;
  selectedPrimaryId: string;
  selectedSecondaryId: string;
  servers: IntegrationServerOption[];
  secondaryOptions: IntegrationChannelOption[];
  onAuthorize: () => void;
  onSelectPrimary: (id: string) => void;
  onSelectSecondary: (id: string) => void;
  onActivate: () => void;
}

export function SlackIntegrationModal({
  open,
  onOpenChange,
  step,
  authorized,
  selectedPrimaryId,
  selectedSecondaryId,
  servers,
  secondaryOptions,
  onAuthorize,
  onSelectPrimary,
  onSelectSecondary,
  onActivate,
}: SlackIntegrationModalProps) {
  const { t } = useTranslation();

  const channelSelect = selectedPrimaryId ? (
    <Field>
      <FieldLabel className="text-sm text-muted-foreground">
        {t("integrations.channel")}
      </FieldLabel>
      <Select
        value={selectedSecondaryId}
        onValueChange={onSelectSecondary}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("integrations.selectChannel")} />
        </SelectTrigger>
        <SelectContent>
          {secondaryOptions.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              {channel.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  ) : null;

  return (
    <PlatformConnectModal
      open={open}
      onOpenChange={onOpenChange}
      step={step}
      authorized={authorized}
      selectedPrimaryId={selectedPrimaryId}
      servers={servers}
      onAuthorize={onAuthorize}
      onSelectPrimary={onSelectPrimary}
      onActivate={onActivate}
      config={slackConfig}
      extraSelectContent={channelSelect}
      activateDisabled={!selectedPrimaryId || !selectedSecondaryId}
    />
  );
}
