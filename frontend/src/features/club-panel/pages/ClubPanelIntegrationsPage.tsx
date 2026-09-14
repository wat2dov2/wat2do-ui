import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Link, MessageCircle, Discord } from "@/shared/ui/doodle-icons";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { InstagramIcon, SlackIcon, TelegramIcon, LinkedInIcon, FacebookIcon } from "@/shared/ui/platform-icons";
import { useIntegrations } from "@/features/club-panel/hooks/useIntegrations";
import { IntegrationCard } from "@/features/club-panel/components/IntegrationCard";
import { DiscordConnectSection } from "@/features/club-panel/components/DiscordConnectSection";
import { WhatsAppConnectModal } from "@/features/club-panel/components/WhatsAppConnectModal";
import { InstagramIntegrationModal } from "@/features/club-panel/components/InstagramIntegrationModal";
import { SlackIntegrationModal } from "@/features/club-panel/components/SlackIntegrationModal";
import { TelegramIntegrationModal } from "@/features/club-panel/components/TelegramIntegrationModal";
import { LinkedInIntegrationModal } from "@/features/club-panel/components/LinkedInIntegrationModal";
import { FacebookIntegrationModal } from "@/features/club-panel/components/FacebookIntegrationModal";

export function ClubPanelIntegrationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const integrations = useIntegrations();

  const actionDisabled = integrations.loading || integrations.saving || !integrations.selectedClubId;

  return (
    <Stack gap={5}>
      <PageHeader
        back={{
          label: t("clubPanel.backToPanel"),
          onClick: () => router.push(ROUTES.CLUB_PANEL),
        }}
        icon={Link}
        title={t("clubPanel.integrations")}
        description={t("integrations.pageDescription")}
      />

      {integrations.error && <p className="text-xs text-destructive">{integrations.error}</p>}

      <Stack gap={4}>
        <IntegrationCard
          integration={integrations.getIntegration("whatsapp")}
          platform="whatsapp"
          icon={<MessageCircle className="size-6 text-green-600" />}
          iconBgClassName="bg-green-100"
          titleKey="clubPanel.whatsapp"
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
          titleKey="clubPanel.discord"
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
      </Stack>

      <DiscordConnectSection
        discord={integrations.discord}
        saving={integrations.saving}
        selectedClubId={integrations.selectedClubId}
      />

      <WhatsAppConnectModal
        open={integrations.whatsappModalOpen}
        onOpenChange={integrations.setWhatsappModalOpen}
        onDone={integrations.handleWhatsAppDone}
      />

      <InstagramIntegrationModal
        open={integrations.instagramModalOpen}
        onOpenChange={integrations.setInstagramModalOpen}
        handle={integrations.instagramHandle}
        onHandleChange={integrations.setInstagramHandle}
        onConnect={integrations.handleInstagramConnect}
      />

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
    </Stack>
  );
}
