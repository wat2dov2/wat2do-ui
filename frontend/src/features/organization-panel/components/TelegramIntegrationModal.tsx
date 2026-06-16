import { PlatformConnectModal, type PlatformConnectConfig, type PlatformConnectModalProps } from "./PlatformConnectModal";

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

export function TelegramIntegrationModal(props: Omit<PlatformConnectModalProps, "config">) {
  return <PlatformConnectModal {...props} config={telegramConfig} />;
}
