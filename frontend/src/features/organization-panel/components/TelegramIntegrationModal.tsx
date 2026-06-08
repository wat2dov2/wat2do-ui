import { PlatformConnectModal, type PlatformConnectConfig } from "./PlatformConnectModal";
import type { IntegrationServerOption } from "@/features/organization-panel/api/integrations.api";

const telegramConfig: PlatformConnectConfig = {
  titleKey: "integrations.connectTelegram",
  step1DescKey: "integrations.telegramStep1Desc",
  step2DescKey: "integrations.telegramStep2Desc",
  connectLabelKey: "integrations.step1AddBot",
  connectDescKey: "integrations.addTelegramBotDescription",
  authorizedTextKey: "integrations.botAdded",
  authorizeTextKey: "integrations.addTelegramBot",
  brandColorClass: "bg-sky-600 hover:bg-sky-700",
  selectLabelKey: "integrations.step2SelectGroup",
  primaryFieldLabelKey: "integrations.group",
  primaryPlaceholderKey: "integrations.selectGroup",
  noteKey: "integrations.telegramAutoPublishNote",
};

interface TelegramIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: "connect" | "select";
  authorized: boolean;
  selectedPrimaryId: string;
  servers: IntegrationServerOption[];
  onAuthorize: () => void;
  onSelectPrimary: (id: string) => void;
  onActivate: () => void;
}

export function TelegramIntegrationModal(props: TelegramIntegrationModalProps) {
  return <PlatformConnectModal {...props} config={telegramConfig} />;
}
