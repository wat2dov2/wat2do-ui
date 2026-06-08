import { PlatformConnectModal, type PlatformConnectConfig } from "./PlatformConnectModal";
import type { IntegrationServerOption } from "@/features/organization-panel/api/integrations.api";

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

interface LinkedInIntegrationModalProps {
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

export function LinkedInIntegrationModal(props: LinkedInIntegrationModalProps) {
  return <PlatformConnectModal {...props} config={linkedInConfig} />;
}
