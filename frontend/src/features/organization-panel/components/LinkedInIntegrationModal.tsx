import { PlatformConnectModal, type PlatformConnectConfig, type PlatformConnectModalProps } from "./PlatformConnectModal";

const linkedInConfig: PlatformConnectConfig = {
  titleKey: "integrations.connectLinkedIn",
  step1DescKey: "integrations.linkedinStep1Desc",
  step2DescKey: "integrations.linkedinStep2Desc",
  connectLabelKey: "integrations.step1ConnectAccount",
  connectDescKey: "integrations.linkedinConnectDescription",
  authorizedTextKey: "integrations.accountConnected",
  authorizeTextKey: "integrations.connectWithLinkedIn",
  brandColorClass: "bg-blue-700 hover:bg-blue-800",
  selectLabelKey: "integrations.step2SelectPage",
  primaryFieldLabelKey: "integrations.companyPage",
  primaryPlaceholderKey: "integrations.selectPage",
  noteKey: "integrations.linkedinAutoPublishNote",
};

export function LinkedInIntegrationModal(props: Omit<PlatformConnectModalProps, "config">) {
  return <PlatformConnectModal {...props} config={linkedInConfig} />;
}
