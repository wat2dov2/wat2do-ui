import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  connectPlatformIntegration,
  disconnectPlatformIntegration,
  type IntegrationChannelOption,
  type IntegrationPlatform,
  type IntegrationServerOption,
} from "@/features/club-panel/api/integrations.api";
import { useIntegrationData, mapResponseToIntegration } from "./useIntegrationData";
import { useDiscordIntegration } from "./useDiscordIntegration";
import { usePlatformConnect } from "./usePlatformConnect";

export type { Integration } from "./useIntegrationData";

export function useIntegrations() {
  const { t } = useTranslation();
  const data = useIntegrationData();
  const {
    integrations,
    setIntegrations,
    selectedClubId,
    options,
    redirectIfUnauthorized,
    setError,
  } = data;

  // Saving state (for connect/disconnect operations)
  const [saving, setSaving] = useState(false);

  // Simple platform states (WhatsApp, Instagram)
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [instagramModalOpen, setInstagramModalOpen] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState("");

  // --- Shared connect/disconnect logic ---

  const applyConnectedIntegration = useCallback(
    (
      platform: IntegrationPlatform,
      payload: { name: string; metadata?: Record<string, string> }
    ) => {
      if (!selectedClubId) {
        setError(t("integrations.errors.noAssociatedClub"));
        return;
      }
      setSaving(true);
      setError(null);
      connectPlatformIntegration(selectedClubId, platform, {
        connected: true,
        name: payload.name,
        metadata: payload.metadata ?? {},
      })
        .then((integration) => {
          setIntegrations((prev) =>
            prev.map((i) =>
              i.platform === platform ? mapResponseToIntegration(platform, integration) : i
            )
          );
        })
        .catch((err) => {
          console.error(`Failed to connect ${platform} integration:`, err);
          if (redirectIfUnauthorized(err)) return;
          setError(t("integrations.errors.connectFailed", { platform }));
        })
        .finally(() => setSaving(false));
    },
    [selectedClubId, redirectIfUnauthorized, setError, setIntegrations, t]
  );

  const handleDisconnect = async (platform: IntegrationPlatform) => {
    if (!selectedClubId) return;
    setSaving(true);
    setError(null);
    try {
      const integration = await disconnectPlatformIntegration(selectedClubId, platform);
      setIntegrations((prev) =>
        prev.map((i) =>
          i.platform === platform ? mapResponseToIntegration(platform, integration) : i
        )
      );
    } catch (err) {
      console.error(`Failed to disconnect ${platform} integration:`, err);
      if (redirectIfUnauthorized(err)) return;
      setError(`Failed to disconnect ${platform} integration.`);
    } finally {
      setSaving(false);
    }
  };

  // --- Shared apply callback factory (eliminates per-platform wrappers) ---
  const makeApplyConnection = useCallback(
    (platform: IntegrationPlatform) =>
      (name: string, metadata: Record<string, string>) => {
        applyConnectedIntegration(platform, { name, metadata });
      },
    [applyConnectedIntegration]
  );

  // --- Discord (extracted hook) ---
  const discord = useDiscordIntegration(
    options.discordServers,
    options.discordOauthUrl,
    makeApplyConnection("discord")
  );

  // --- Platform-specific connection payload configs ---
  type GenericPlatform = "slack" | "telegram" | "linkedin" | "facebook";

  type PayloadBuilder = (
    primary: IntegrationServerOption,
    secondary: IntegrationChannelOption | undefined
  ) => { name: string; metadata: Record<string, string> } | null;

  const platformConfigs: Record<
    GenericPlatform,
    {
      servers: IntegrationServerOption[];
      oauthUrl?: string;
      buildConnectionPayload: PayloadBuilder;
    }
  > = {
    slack: {
      servers: options.slackServers,
      oauthUrl: options.slackOauthUrl,
      buildConnectionPayload: (workspace, channel) => {
        if (!channel) return null;
        return {
          name: `${workspace.name} - ${channel.name}`,
          metadata: {
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            channel_id: channel.id,
            channel_name: channel.name,
          },
        };
      },
    },
    telegram: {
      servers: options.telegramServers,
      buildConnectionPayload: (group) => ({
        name: group.name,
        metadata: { group_id: group.id, group_name: group.name },
      }),
    },
    linkedin: {
      servers: options.linkedinServers,
      oauthUrl: options.linkedinOauthUrl,
      buildConnectionPayload: (page) => ({
        name: page.name,
        metadata: { page_id: page.id, page_name: page.name },
      }),
    },
    facebook: {
      servers: options.facebookTargets,
      oauthUrl: options.facebookOauthUrl,
      buildConnectionPayload: (target) => ({
        name: target.name,
        metadata: (() => {
          if (target.id.startsWith("page:")) {
            return { page_id: target.id.replace("page:", ""), connection_type: "page" };
          }
          return { group_id: target.id.replace("group:", ""), connection_type: "group" };
        })(),
      }),
    },
  };

  // --- Generic platform hooks (driven by config, not separate code paths) ---
  const platformConnects = {
    slack: usePlatformConnect({
      servers: platformConfigs.slack.servers,
      oauthUrl: platformConfigs.slack.oauthUrl,
      applyConnection: makeApplyConnection("slack"),
      buildConnectionPayload: platformConfigs.slack.buildConnectionPayload,
    }),
    telegram: usePlatformConnect({
      servers: platformConfigs.telegram.servers,
      oauthUrl: platformConfigs.telegram.oauthUrl,
      applyConnection: makeApplyConnection("telegram"),
      buildConnectionPayload: platformConfigs.telegram.buildConnectionPayload,
    }),
    linkedin: usePlatformConnect({
      servers: platformConfigs.linkedin.servers,
      oauthUrl: platformConfigs.linkedin.oauthUrl,
      applyConnection: makeApplyConnection("linkedin"),
      buildConnectionPayload: platformConfigs.linkedin.buildConnectionPayload,
    }),
    facebook: usePlatformConnect({
      servers: platformConfigs.facebook.servers,
      oauthUrl: platformConfigs.facebook.oauthUrl,
      applyConnection: makeApplyConnection("facebook"),
      buildConnectionPayload: platformConfigs.facebook.buildConnectionPayload,
    }),
  };

  // --- Platform connect dispatcher ---
  const platformConnectHandlers: Record<IntegrationPlatform, () => void> = {
    discord: discord.openFlow,
    whatsapp: () => setWhatsappModalOpen(true),
    instagram: () => { setInstagramModalOpen(true); setInstagramHandle(""); },
    slack: platformConnects.slack.openFlow,
    telegram: platformConnects.telegram.openFlow,
    linkedin: platformConnects.linkedin.openFlow,
    facebook: platformConnects.facebook.openFlow,
  };

  const handleConnect = (platform: IntegrationPlatform) => {
    setError(null);
    platformConnectHandlers[platform]();
  };

  // --- Simple platform handlers (WhatsApp, Instagram) ---

  const handleWhatsAppDone = () => {
    applyConnectedIntegration("whatsapp", { name: t("integrations.defaultWhatsAppGroupName") });
    setWhatsappModalOpen(false);
  };

  const handleInstagramConnect = () => {
    if (!instagramHandle) return;
    applyConnectedIntegration("instagram", {
      name: `@${instagramHandle}`,
      metadata: { handle: instagramHandle },
    });
    setInstagramModalOpen(false);
  };

  return {
    // Core data (from useIntegrationData)
    integrations,
    selectedClubId: data.selectedClubId,
    loading: data.loading,
    saving,
    error: data.error,
    getIntegration: data.getIntegration,

    // Top-level handlers
    handleConnect,
    handleDisconnect,

    // Discord (extracted hook)
    discord,

    // WhatsApp
    whatsappModalOpen,
    setWhatsappModalOpen,
    handleWhatsAppDone,

    // Instagram
    instagramModalOpen,
    setInstagramModalOpen,
    instagramHandle,
    setInstagramHandle,
    handleInstagramConnect,

    // Generic platform hooks
    platformConnects,
  };
}
