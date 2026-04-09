import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import type { Club } from "@/shared/types";
import { ApiError } from "@/shared/services/apiClient";
import { getAllClubs } from "@/features/clubs";
import {
  connectPlatformIntegration,
  disconnectPlatformIntegration,
  getIntegrationOptions,
  getPlatformIntegration,
  type IntegrationPlatform,
  type IntegrationServerOption,
} from "@/features/club-panel/api/integrations.api";

export interface Integration {
  platform: IntegrationPlatform;
  connected: boolean;
  name?: string;
  lastSync?: string;
  serverId?: string;
  channelId?: string;
  workspaceId?: string;
  handle?: string;
  pageId?: string;
  groupId?: string;
  connectionType?: "page" | "group";
}

const ALL_PLATFORMS: IntegrationPlatform[] = [
  "whatsapp",
  "discord",
  "instagram",
  "slack",
  "telegram",
  "linkedin",
  "facebook",
];

function buildInitialIntegrations(): Integration[] {
  return ALL_PLATFORMS.map((platform) => ({ platform, connected: false }));
}

function mapResponseToIntegration(
  platform: IntegrationPlatform,
  row: { connected: boolean; name?: string | null; last_sync?: string | null; metadata?: Record<string, string> | null }
): Integration {
  const metadata = row.metadata ?? {};
  return {
    platform,
    connected: Boolean(row.connected),
    name: row.name || undefined,
    lastSync: row.last_sync || undefined,
    serverId: metadata.server_id,
    channelId: metadata.channel_id,
    workspaceId: metadata.workspace_id,
    handle: metadata.handle,
    pageId: metadata.page_id,
    groupId: metadata.group_id,
    connectionType: metadata.connection_type as "page" | "group" | undefined,
  };
}

export function useIntegrations() {
  const navigate = useNavigate();

  // Core data
  const [integrations, setIntegrations] = useState<Integration[]>(buildInitialIntegrations);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);

  // Server/option lists per platform
  const [discordServers, setDiscordServers] = useState<IntegrationServerOption[]>([]);
  const [slackServers, setSlackServers] = useState<IntegrationServerOption[]>([]);
  const [telegramServers, setTelegramServers] = useState<IntegrationServerOption[]>([]);
  const [linkedinServers, setLinkedinServers] = useState<IntegrationServerOption[]>([]);
  const [facebookTargets, setFacebookTargets] = useState<IntegrationServerOption[]>([]);

  // OAuth URLs
  const [discordOauthUrl, setDiscordOauthUrl] = useState("");
  const [slackOauthUrl, setSlackOauthUrl] = useState("");
  const [linkedinOauthUrl, setLinkedinOauthUrl] = useState("");
  const [facebookOauthUrl, setFacebookOauthUrl] = useState("");

  // Modal open states
  const [discordModalOpen, setDiscordModalOpen] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [instagramModalOpen, setInstagramModalOpen] = useState(false);
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [facebookModalOpen, setFacebookModalOpen] = useState(false);

  // Discord connection flow
  const [discordStep, setDiscordStep] = useState<"connect" | "select">("connect");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [botAdded, setBotAdded] = useState(false);

  // Slack connection flow
  const [slackStep, setSlackStep] = useState<"connect" | "select">("connect");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedSlackChannelId, setSelectedSlackChannelId] = useState("");
  const [slackAppAdded, setSlackAppAdded] = useState(false);

  // Instagram connection
  const [instagramHandle, setInstagramHandle] = useState("");

  // Telegram connection flow
  const [telegramStep, setTelegramStep] = useState<"connect" | "select">("connect");
  const [telegramBotAdded, setTelegramBotAdded] = useState(false);
  const [selectedTelegramGroupId, setSelectedTelegramGroupId] = useState("");

  // LinkedIn connection flow
  const [linkedinStep, setLinkedinStep] = useState<"connect" | "select">("connect");
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [selectedLinkedinPageId, setSelectedLinkedinPageId] = useState("");

  // Facebook connection flow
  const [facebookStep, setFacebookStep] = useState<"connect" | "select">("connect");
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookConnectionType, setFacebookConnectionType] = useState<"page" | "group">("page");
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState("");
  const [selectedFacebookGroupId, setSelectedFacebookGroupId] = useState("");

  // Loading / error
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectIfUnauthorized = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) {
        navigate(ROUTES.LOGIN, { replace: true });
        return true;
      }
      return false;
    },
    [navigate]
  );

  // --- Boot data (clubs + platform options) ---
  useEffect(() => {
    const loadBootData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [
          clubsData,
          discordOptions,
          slackOptions,
          telegramOptions,
          linkedinOptions,
          facebookOptions,
        ] = await Promise.all([
          getAllClubs(),
          getIntegrationOptions("discord"),
          getIntegrationOptions("slack"),
          getIntegrationOptions("telegram"),
          getIntegrationOptions("linkedin"),
          getIntegrationOptions("facebook"),
        ]);
        setClubs(clubsData);
        setDiscordServers(discordOptions.servers);
        setSlackServers(slackOptions.servers);
        setTelegramServers(telegramOptions.servers);
        setLinkedinServers(linkedinOptions.servers);
        setFacebookTargets(facebookOptions.servers);
        setDiscordOauthUrl(discordOptions.oauth_url ?? "");
        setSlackOauthUrl(slackOptions.oauth_url ?? "");
        setLinkedinOauthUrl(linkedinOptions.oauth_url ?? "");
        setFacebookOauthUrl(facebookOptions.oauth_url ?? "");
        if (clubsData.length > 0) {
          setSelectedClubId((prev) => prev ?? clubsData[0].id);
        }
      } catch (err) {
        console.error("Failed to load integration settings:", err);
        if (redirectIfUnauthorized(err)) return;
        setError("Failed to load integration settings.");
      } finally {
        setLoading(false);
      }
    };
    void loadBootData();
  }, [redirectIfUnauthorized]);

  // --- Load integrations for selected club ---
  useEffect(() => {
    if (!selectedClubId) return;
    const loadIntegrations = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await Promise.all(
          ALL_PLATFORMS.map((platform) => getPlatformIntegration(selectedClubId, platform))
        );
        const byPlatform = new Map(data.map((row) => [row.platform, row]));
        setIntegrations(
          ALL_PLATFORMS.map((platform) => {
            const row = byPlatform.get(platform);
            if (!row) return { platform, connected: false };
            return mapResponseToIntegration(platform, row);
          })
        );
      } catch (err) {
        console.error("Failed to load integrations:", err);
        if (redirectIfUnauthorized(err)) return;
        setError("Failed to load integrations.");
      } finally {
        setLoading(false);
      }
    };
    void loadIntegrations();
  }, [selectedClubId, redirectIfUnauthorized]);

  // --- Shared connect/disconnect logic ---
  const getIntegration = (platform: IntegrationPlatform) =>
    integrations.find((i) => i.platform === platform);

  const applyConnectedIntegration = (
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
  };

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

  const handleConnect = (platform: IntegrationPlatform) => {
    setError(null);
    switch (platform) {
      case "discord":
        setDiscordStep("connect");
        setBotAdded(false);
        setSelectedServerId("");
        setSelectedChannelId("");
        setDiscordModalOpen(true);
        break;
      case "whatsapp":
        setWhatsappModalOpen(true);
        break;
      case "instagram":
        setInstagramHandle("");
        setInstagramModalOpen(true);
        break;
      case "slack":
        setSlackStep("connect");
        setSlackAppAdded(false);
        setSelectedWorkspaceId("");
        setSelectedSlackChannelId("");
        setSlackModalOpen(true);
        break;
      case "telegram":
        setTelegramStep("connect");
        setTelegramBotAdded(false);
        setSelectedTelegramGroupId("");
        setTelegramModalOpen(true);
        break;
      case "linkedin":
        setLinkedinStep("connect");
        setLinkedinConnected(false);
        setSelectedLinkedinPageId("");
        setLinkedinModalOpen(true);
        break;
      case "facebook":
        setFacebookStep("connect");
        setFacebookConnected(false);
        setFacebookConnectionType("page");
        setSelectedFacebookPageId("");
        setSelectedFacebookGroupId("");
        setFacebookModalOpen(true);
        break;
    }
  };

  // --- Per-platform handlers ---

  const handleAddToDiscord = () => {
    if (discordOauthUrl) {
      window.open(discordOauthUrl, "_blank", "noopener,noreferrer");
    }
    setBotAdded(true);
    setDiscordStep("select");
  };

  const handleActivateDiscord = () => {
    const server = discordServers.find((s) => s.id === selectedServerId);
    const channel = server?.channels.find((c) => c.id === selectedChannelId);
    if (!server || !channel) return;
    applyConnectedIntegration("discord", {
      name: `${server.name} - ${channel.name}`,
      metadata: {
        server_id: server.id,
        server_name: server.name,
        channel_id: channel.id,
        channel_name: channel.name,
      },
    });
    setDiscordModalOpen(false);
  };

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

  const handleAddToSlack = () => {
    if (slackOauthUrl) {
      window.open(slackOauthUrl, "_blank", "noopener,noreferrer");
    }
    setSlackAppAdded(true);
    setSlackStep("select");
  };

  const handleActivateSlack = () => {
    const workspace = slackServers.find((w) => w.id === selectedWorkspaceId);
    const channel = workspace?.channels.find((c) => c.id === selectedSlackChannelId);
    if (!workspace || !channel) return;
    applyConnectedIntegration("slack", {
      name: `${workspace.name} - ${channel.name}`,
      metadata: {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        channel_id: channel.id,
        channel_name: channel.name,
      },
    });
    setSlackModalOpen(false);
  };

  const handleAddTelegramBot = () => {
    setTelegramBotAdded(true);
    setTelegramStep("select");
  };

  const handleActivateTelegram = () => {
    const group = telegramServers.find((g) => g.id === selectedTelegramGroupId);
    if (!group) return;
    applyConnectedIntegration("telegram", {
      name: group.name,
      metadata: { group_id: group.id, group_name: group.name },
    });
    setTelegramModalOpen(false);
  };

  const handleLinkedinAuth = () => {
    if (linkedinOauthUrl) {
      window.open(linkedinOauthUrl, "_blank", "noopener,noreferrer");
    }
    setLinkedinConnected(true);
    setLinkedinStep("select");
  };

  const handleActivateLinkedin = () => {
    const page = linkedinServers.find((p) => p.id === selectedLinkedinPageId);
    if (!page) return;
    applyConnectedIntegration("linkedin", {
      name: page.name,
      metadata: { page_id: page.id, page_name: page.name },
    });
    setLinkedinModalOpen(false);
  };

  const handleFacebookAuth = () => {
    if (facebookOauthUrl) {
      window.open(facebookOauthUrl, "_blank", "noopener,noreferrer");
    }
    setFacebookConnected(true);
    setFacebookStep("select");
  };

  const handleActivateFacebook = () => {
    if (facebookConnectionType === "page") {
      const page = facebookTargets.find((p) => p.id === `page:${selectedFacebookPageId}`);
      if (!page) return;
      applyConnectedIntegration("facebook", {
        name: page.name,
        metadata: { page_id: selectedFacebookPageId, connection_type: "page" },
      });
    } else {
      const group = facebookTargets.find((g) => g.id === `group:${selectedFacebookGroupId}`);
      if (!group) return;
      applyConnectedIntegration("facebook", {
        name: group.name,
        metadata: { group_id: selectedFacebookGroupId, connection_type: "group" },
      });
    }
    setFacebookModalOpen(false);
  };

  return {
    // Core data
    integrations,
    clubs,
    selectedClubId,
    setSelectedClubId,
    loading,
    saving,
    error,
    getIntegration,

    // Top-level handlers
    handleConnect,
    handleDisconnect,

    // Modal open/close
    discordModalOpen,
    setDiscordModalOpen,
    whatsappModalOpen,
    setWhatsappModalOpen,
    instagramModalOpen,
    setInstagramModalOpen,
    slackModalOpen,
    setSlackModalOpen,
    telegramModalOpen,
    setTelegramModalOpen,
    linkedinModalOpen,
    setLinkedinModalOpen,
    facebookModalOpen,
    setFacebookModalOpen,

    // Discord flow
    discordStep,
    selectedServerId,
    setSelectedServerId,
    selectedChannelId,
    setSelectedChannelId,
    botAdded,
    discordServers,
    handleAddToDiscord,
    handleActivateDiscord,

    // WhatsApp
    handleWhatsAppDone,

    // Instagram
    instagramHandle,
    setInstagramHandle,
    handleInstagramConnect,

    // Slack flow
    slackStep,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedSlackChannelId,
    setSelectedSlackChannelId,
    slackAppAdded,
    slackServers,
    handleAddToSlack,
    handleActivateSlack,

    // Telegram flow
    telegramStep,
    telegramBotAdded,
    selectedTelegramGroupId,
    setSelectedTelegramGroupId,
    telegramServers,
    handleAddTelegramBot,
    handleActivateTelegram,

    // LinkedIn flow
    linkedinStep,
    linkedinConnected,
    selectedLinkedinPageId,
    setSelectedLinkedinPageId,
    linkedinServers,
    handleLinkedinAuth,
    handleActivateLinkedin,

    // Facebook flow
    facebookStep,
    facebookConnected,
    facebookConnectionType,
    setFacebookConnectionType,
    selectedFacebookPageId,
    setSelectedFacebookPageId,
    selectedFacebookGroupId,
    setSelectedFacebookGroupId,
    facebookTargets,
    handleFacebookAuth,
    handleActivateFacebook,
  };
}
