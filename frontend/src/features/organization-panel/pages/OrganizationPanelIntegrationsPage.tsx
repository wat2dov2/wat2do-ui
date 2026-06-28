import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link, MessageCircle, Discord } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { ROUTES } from "@/shared/constants/routes";
import { InstagramIcon, SlackIcon, TelegramIcon, LinkedInIcon, FacebookIcon } from "@/shared/ui/platform-icons";
import { useIntegrations } from "@/features/organization-panel/hooks/useIntegrations";
import { IntegrationCard } from "@/features/organization-panel/components/IntegrationCard";
import { DiscordConnectSection } from "@/features/organization-panel/components/DiscordConnectSection";
import { WhatsAppConnectModal } from "@/features/organization-panel/components/WhatsAppConnectModal";
import { InstagramIntegrationModal } from "@/features/organization-panel/components/InstagramIntegrationModal";
import { SlackIntegrationModal } from "@/features/organization-panel/components/SlackIntegrationModal";
import { TelegramIntegrationModal } from "@/features/organization-panel/components/TelegramIntegrationModal";
import { LinkedInIntegrationModal } from "@/features/organization-panel/components/LinkedInIntegrationModal";
import { FacebookIntegrationModal } from "@/features/organization-panel/components/FacebookIntegrationModal";

export function OrganizationPanelIntegrationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const integrations = useIntegrations();

  const actionDisabled = integrations.loading || integrations.saving || !integrations.selectedClubId;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onMouseDown={() => router.push(ROUTES.ORGANIZATION_PANEL)}
          className="shrink-0"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Link className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("organizationPanel.integrations")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("integrations.pageDescription")}
          </p>
        </div>
      </div>

      {integrations.error && <p className="text-xs text-error">{integrations.error}</p>}

      {/* Integration Cards */}
      <div className="space-y-4">
        <IntegrationCard
          integration={integrations.getIntegration("whatsapp")}
          platform="whatsapp"
          icon={<MessageCircle className="size-6 text-green-600" />}
          iconBgClassName="bg-green-100"
          titleKey="organizationPanel.whatsapp"
          descriptionKey="integrations.whatsappScrapeDesc"
          onConnect={() => integrations.handleConnect("whatsapp")}
          onDisconnect={() => integrations.handleDisconnect("whatsapp")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("discord")}
          platform="discord"
          icon={<Discord className="size-6 text-primary" />}
          iconBgClassName="bg-primary/15"
          titleKey="organizationPanel.discord"
          descriptionKey="integrations.discordScrapeDesc"
          onConnect={() => integrations.handleConnect("discord")}
          onDisconnect={() => integrations.handleDisconnect("discord")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("instagram")}
          platform="instagram"
          icon={<InstagramIcon className="size-6 text-pink-600" />}
          iconBgClassName="bg-linear-to-br from-purple-100 to-pink-100"
          titleKey="integrations.instagram"
          descriptionKey="integrations.instagramScrapeDesc"
          onConnect={() => integrations.handleConnect("instagram")}
          onDisconnect={() => integrations.handleDisconnect("instagram")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("slack")}
          platform="slack"
          icon={<SlackIcon className="size-6 text-purple-600" />}
          iconBgClassName="bg-purple-100"
          titleKey="integrations.slack"
          descriptionKey="integrations.slackScrapeDesc"
          onConnect={() => integrations.handleConnect("slack")}
          onDisconnect={() => integrations.handleDisconnect("slack")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("telegram")}
          platform="telegram"
          icon={<TelegramIcon className="size-6 text-sky-600" />}
          iconBgClassName="bg-sky-100"
          titleKey="integrations.telegram"
          descriptionKey="integrations.telegramScrapeDesc"
          onConnect={() => integrations.handleConnect("telegram")}
          onDisconnect={() => integrations.handleDisconnect("telegram")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("linkedin")}
          platform="linkedin"
          icon={<LinkedInIcon className="size-6 text-blue-700" />}
          iconBgClassName="bg-blue-100"
          titleKey="integrations.linkedin"
          descriptionKey="integrations.linkedinScrapeDesc"
          onConnect={() => integrations.handleConnect("linkedin")}
          onDisconnect={() => integrations.handleDisconnect("linkedin")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("facebook")}
          platform="facebook"
          icon={<FacebookIcon className="size-6 text-blue-600" />}
          iconBgClassName="bg-blue-100"
          titleKey="integrations.facebook"
          descriptionKey="integrations.facebookScrapeDesc"
          onConnect={() => integrations.handleConnect("facebook")}
          onDisconnect={() => integrations.handleDisconnect("facebook")}
          disabled={actionDisabled}
        />
      </div>

      {/* Discord Connection Modal */}
      <DiscordConnectSection
        discord={integrations.discord}
        saving={integrations.saving}
        selectedClubId={integrations.selectedClubId}
      />

      {/* WhatsApp Connection Modal */}
      <WhatsAppConnectModal
        open={integrations.whatsappModalOpen}
        onOpenChange={integrations.setWhatsappModalOpen}
        onDone={integrations.handleWhatsAppDone}
      />

      {/* Instagram Connection Modal */}
      <InstagramIntegrationModal
        open={integrations.instagramModalOpen}
        onOpenChange={integrations.setInstagramModalOpen}
        handle={integrations.instagramHandle}
        onHandleChange={integrations.setInstagramHandle}
        onConnect={integrations.handleInstagramConnect}
      />

      {/* Slack Connection Modal (has secondary selection, so wired individually) */}
      <SlackIntegrationModal
        open={integrations.platformConnects.slack.modalOpen}
        onOpenChange={integrations.platformConnects.slack.setModalOpen}
        step={integrations.platformConnects.slack.step}
        authorized={integrations.platformConnects.slack.authorized}
        selectedPrimaryId={integrations.platformConnects.slack.selectedPrimaryId}
        selectedSecondaryId={integrations.platformConnects.slack.selectedSecondaryId}
        servers={integrations.platformConnects.slack.servers}
        secondaryOptions={integrations.platformConnects.slack.secondaryOptions}
        onAuthorize={integrations.platformConnects.slack.handleAuthorize}
        onSelectPrimary={integrations.platformConnects.slack.setSelectedPrimaryId}
        onSelectSecondary={integrations.platformConnects.slack.setSelectedSecondaryId}
        onActivate={integrations.platformConnects.slack.handleActivate}
      />

      {/* Telegram / LinkedIn / Facebook — share the same modal prop shape */}
      {([
        ["telegram", TelegramIntegrationModal],
        ["linkedin", LinkedInIntegrationModal],
        ["facebook", FacebookIntegrationModal],
      ] as const).map(([key, Modal]) => {
        const pc = integrations.platformConnects[key];
        return (
          <Modal
            key={key}
            open={pc.modalOpen}
            onOpenChange={pc.setModalOpen}
            step={pc.step}
            authorized={pc.authorized}
            selectedPrimaryId={pc.selectedPrimaryId}
            servers={pc.servers}
            onAuthorize={pc.handleAuthorize}
            onSelectPrimary={pc.setSelectedPrimaryId}
            onActivate={pc.handleActivate}
          />
        );
      })}
    </div>
  );
}
