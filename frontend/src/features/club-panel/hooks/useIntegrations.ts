import { useCallback, useState } from "react";
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
        setError("Please select a club before connecting integrations.");
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
          setError(`Failed to connect ${platform} integration.`);
        })
        .finally(() => setSaving(false));
    },
    [selectedClubId, redirectIfUnauthorized, setError, setIntegrations]
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
  type PayloadBuilder = (
    primary: IntegrationServerOption,
    secondary: IntegrationChannelOption | undefined
  ) => { name: string; metadata: Record<string, string> } | null;

  const platformConfigs: {
    key: "slack" | "telegram" | "linkedin" | "facebook";
    servers: IntegrationServerOption[];
    oauthUrl?: string;
    buildConnectionPayload: PayloadBuilder;
  }[] = [
    {
      key: "slack",
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
    {
      key: "telegram",
      servers: options.telegramServers,
      buildConnectionPayload: (group) => ({
        name: group.name,
        metadata: { group_id: group.id, group_name: group.name },
      }),
    },
    {
      key: "linkedin",
      servers: options.linkedinServers,
      oauthUrl: options.linkedinOauthUrl,
      buildConnectionPayload: (page) => ({
        name: page.name,
        metadata: { page_id: page.id, page_name: page.name },
      }),
    },
    {
      key: "facebook",
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
  ];

  // --- Generic platform hooks (driven by config, not separate code paths) ---
  const slack = usePlatformConnect({
    servers: platformConfigs[0].servers,
    oauthUrl: platformConfigs[0].oauthUrl,
    applyConnection: makeApplyConnection("slack"),
    buildConnectionPayload: platformConfigs[0].buildConnectionPayload,
  });

  const telegram = usePlatformConnect({
    servers: platformConfigs[1].servers,
    oauthUrl: platformConfigs[1].oauthUrl,
    applyConnection: makeApplyConnection("telegram"),
    buildConnectionPayload: platformConfigs[1].buildConnectionPayload,
  });

  const linkedin = usePlatformConnect({
    servers: platformConfigs[2].servers,
    oauthUrl: platformConfigs[2].oauthUrl,
    applyConnection: makeApplyConnection("linkedin"),
    buildConnectionPayload: platformConfigs[2].buildConnectionPayload,
  });

  const facebook = usePlatformConnect({
    servers: platformConfigs[3].servers,
    oauthUrl: platformConfigs[3].oauthUrl,
    applyConnection: makeApplyConnection("facebook"),
    buildConnectionPayload: platformConfigs[3].buildConnectionPayload,
  });

  // --- Platform connect dispatcher ---
  const platformConnectHandlers: Record<IntegrationPlatform, () => void> = {
    discord: discord.openFlow,
    whatsapp: () => setWhatsappModalOpen(true),
    instagram: () => { setInstagramModalOpen(true); setInstagramHandle(""); },
    slack: slack.openFlow,
    telegram: telegram.openFlow,
    linkedin: linkedin.openFlow,
    facebook: facebook.openFlow,
  };

  const handleConnect = (platform: IntegrationPlatform) => {
    setError(null);
    platformConnectHandlers[platform]();
  };

  // --- Simple platform handlers (WhatsApp, Instagram) ---

  const handleWhatsAppDone = () => {
    applyConnectedIntegration("whatsapp", { name: "UW Tech Club Group" });
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

  // Expose generic platform hook states as a record so the page can iterate
  const platformConnects = { slack, telegram, linkedin, facebook };

  return {
    // Core data (from useIntegrationData)
    integrations,
    clubs: data.clubs,
    selectedClubId: data.selectedClubId,
    setSelectedClubId: data.setSelectedClubId,
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

    // Generic platform hooks (individual + record for iteration)
    slack,
    telegram,
    linkedin,
    facebook,
    platformConnects,
  };
}
