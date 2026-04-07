import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Link, MessageCircle, Check, ExternalLink, AtSign } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useNavigation } from "@/contexts/NavigationContext";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogClose,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ModalContentWrapper, ModalHeaderWrapper } from "@/shared/ui/modal-components";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";
import type { Club } from "@/shared/types";
import { DiscordIcon, InstagramIcon, SlackIcon, TelegramIcon, LinkedInIcon, FacebookIcon } from "@/shared/ui/platform-icons";
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

interface Integration {
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

export function ClubPanelIntegrationsPage() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();

  // Integration states (mock - not persisted)
  const [integrations, setIntegrations] = useState<Integration[]>([
    { platform: "whatsapp", connected: false },
    { platform: "discord", connected: false },
    { platform: "instagram", connected: false },
    { platform: "slack", connected: false },
    { platform: "telegram", connected: false },
    { platform: "linkedin", connected: false },
    { platform: "facebook", connected: false },
  ]);

  // Modal states
  const [discordModalOpen, setDiscordModalOpen] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [instagramModalOpen, setInstagramModalOpen] = useState(false);
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [facebookModalOpen, setFacebookModalOpen] = useState(false);

  // Discord connection flow state
  const [discordStep, setDiscordStep] = useState<"connect" | "select">("connect");
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [botAdded, setBotAdded] = useState(false);

  // Slack connection flow state
  const [slackStep, setSlackStep] = useState<"connect" | "select">("connect");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedSlackChannelId, setSelectedSlackChannelId] = useState<string>("");
  const [slackAppAdded, setSlackAppAdded] = useState(false);

  // Instagram connection state
  const [instagramHandle, setInstagramHandle] = useState<string>("");

  // Telegram connection state
  const [telegramStep, setTelegramStep] = useState<"connect" | "select">("connect");
  const [telegramBotAdded, setTelegramBotAdded] = useState(false);
  const [selectedTelegramGroupId, setSelectedTelegramGroupId] = useState<string>("");

  // LinkedIn connection state
  const [linkedinStep, setLinkedinStep] = useState<"connect" | "select">("connect");
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [selectedLinkedinPageId, setSelectedLinkedinPageId] = useState<string>("");

  // Facebook connection state
  const [facebookStep, setFacebookStep] = useState<"connect" | "select">("connect");
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookConnectionType, setFacebookConnectionType] = useState<"page" | "group">("page");
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState<string>("");
  const [selectedFacebookGroupId, setSelectedFacebookGroupId] = useState<string>("");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [discordServers, setDiscordServers] = useState<IntegrationServerOption[]>([]);
  const [slackServers, setSlackServers] = useState<IntegrationServerOption[]>([]);
  const [telegramServers, setTelegramServers] = useState<IntegrationServerOption[]>([]);
  const [linkedinServers, setLinkedinServers] = useState<IntegrationServerOption[]>([]);
  const [facebookTargets, setFacebookTargets] = useState<IntegrationServerOption[]>([]);
  const [discordOauthUrl, setDiscordOauthUrl] = useState<string>("");
  const [slackOauthUrl, setSlackOauthUrl] = useState<string>("");
  const [linkedinOauthUrl, setLinkedinOauthUrl] = useState<string>("");
  const [facebookOauthUrl, setFacebookOauthUrl] = useState<string>("");
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);

  const getIntegration = (platform: IntegrationPlatform) =>
    integrations.find((i) => i.platform === platform);

  const redirectIfUnauthorized = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return true;
      }
      return false;
    },
    [navigate]
  );

  useEffect(() => {
    const loadBootData = async () => {
      setDiscordLoading(true);
      setDiscordError(null);
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
      } catch (error) {
        if (redirectIfUnauthorized(error)) return;
        setDiscordError("Failed to load integration settings.");
      } finally {
        setDiscordLoading(false);
      }
    };

    void loadBootData();
  }, [redirectIfUnauthorized]);

  useEffect(() => {
    if (!selectedClubId) return;

    const loadIntegrations = async () => {
      setDiscordLoading(true);
      setDiscordError(null);
      try {
        const platforms: IntegrationPlatform[] = [
          "whatsapp",
          "discord",
          "instagram",
          "slack",
          "telegram",
          "linkedin",
          "facebook",
        ];
        const data = await Promise.all(
          platforms.map((platform) => getPlatformIntegration(selectedClubId, platform))
        );
        const byPlatform = new Map(data.map((row) => [row.platform, row]));
        setIntegrations(
          platforms.map((platform) => {
            const row = byPlatform.get(platform);
            const metadata = row?.metadata ?? {};
            return {
              platform,
              connected: Boolean(row?.connected),
              name: row?.name || undefined,
              lastSync: row?.last_sync || undefined,
              serverId: metadata.server_id,
              channelId: metadata.channel_id,
              workspaceId: metadata.workspace_id,
              handle: metadata.handle,
              pageId: metadata.page_id,
              groupId: metadata.group_id,
              connectionType: metadata.connection_type as "page" | "group" | undefined,
            };
          })
        );
      } catch (error) {
        if (redirectIfUnauthorized(error)) return;
        setDiscordError("Failed to load integrations.");
      } finally {
        setDiscordLoading(false);
      }
    };

    void loadIntegrations();
  }, [selectedClubId, redirectIfUnauthorized]);

  const handleConnect = (platform: IntegrationPlatform) => {
    setDiscordError(null);
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

  const handleDisconnect = async (platform: IntegrationPlatform) => {
    if (!selectedClubId) return;
    setDiscordSaving(true);
    setDiscordError(null);
    try {
      const integration = await disconnectPlatformIntegration(selectedClubId, platform);
      setIntegrations((prev) =>
        prev.map((i) =>
          i.platform === platform
            ? {
                platform,
                connected: integration.connected,
                name: integration.name || undefined,
                lastSync: integration.last_sync || undefined,
                serverId: integration.metadata?.server_id,
                channelId: integration.metadata?.channel_id,
                workspaceId: integration.metadata?.workspace_id,
                handle: integration.metadata?.handle,
                pageId: integration.metadata?.page_id,
                groupId: integration.metadata?.group_id,
                connectionType: integration.metadata?.connection_type as "page" | "group" | undefined,
              }
            : i
        )
      );
    } catch (error) {
      if (redirectIfUnauthorized(error)) return;
      setDiscordError(`Failed to disconnect ${platform} integration.`);
    } finally {
      setDiscordSaving(false);
    }
  };

  const applyConnectedIntegration = (
    platform: IntegrationPlatform,
    payload: {
      name: string;
      metadata?: Record<string, string>;
    }
  ) => {
    if (!selectedClubId) {
      setDiscordError("Please select a club before connecting integrations.");
      return;
    }
    setDiscordSaving(true);
    setDiscordError(null);
    connectPlatformIntegration(selectedClubId, platform, {
      connected: true,
      name: payload.name,
      metadata: payload.metadata ?? {},
    })
      .then((integration) => {
        setIntegrations((prev) =>
          prev.map((i) =>
            i.platform === platform
              ? {
                  platform,
                  connected: integration.connected,
                  name: integration.name || undefined,
                  lastSync: integration.last_sync || undefined,
                  serverId: integration.metadata?.server_id,
                  channelId: integration.metadata?.channel_id,
                  workspaceId: integration.metadata?.workspace_id,
                  handle: integration.metadata?.handle,
                  pageId: integration.metadata?.page_id,
                  groupId: integration.metadata?.group_id,
                  connectionType: integration.metadata?.connection_type as "page" | "group" | undefined,
                }
              : i
          )
        );
      })
      .catch((error) => {
        if (redirectIfUnauthorized(error)) return;
        setDiscordError(`Failed to connect ${platform} integration.`);
      })
      .finally(() => setDiscordSaving(false));
  };

  const handleAddToDiscord = () => {
    if (discordOauthUrl) {
      window.open(discordOauthUrl, "_blank", "noopener,noreferrer");
    }
    setBotAdded(true);
    setDiscordStep("select");
  };

  const handleActivateDiscord = async () => {
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

  const handleWhatsAppDone = async () => {
    applyConnectedIntegration("whatsapp", {
      name: "UW Tech Club Group",
    });
    setWhatsappModalOpen(false);
  };

  // Instagram handlers
  const handleInstagramConnect = async () => {
    if (!instagramHandle) return;
    applyConnectedIntegration("instagram", {
      name: `@${instagramHandle}`,
      metadata: { handle: instagramHandle },
    });
    setInstagramModalOpen(false);
  };

  // Slack handlers
  const handleAddToSlack = () => {
    if (slackOauthUrl) {
      window.open(slackOauthUrl, "_blank", "noopener,noreferrer");
    }
    setSlackAppAdded(true);
    setSlackStep("select");
  };

  const handleActivateSlack = async () => {
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

  // Telegram handlers
  const handleAddTelegramBot = () => {
    setTelegramBotAdded(true);
    setTelegramStep("select");
  };

  const handleActivateTelegram = async () => {
    const group = telegramServers.find((g) => g.id === selectedTelegramGroupId);
    if (!group) return;
    applyConnectedIntegration("telegram", {
      name: group.name,
      metadata: { group_id: group.id, group_name: group.name },
    });
    setTelegramModalOpen(false);
  };

  // LinkedIn handlers
  const handleLinkedinAuth = () => {
    if (linkedinOauthUrl) {
      window.open(linkedinOauthUrl, "_blank", "noopener,noreferrer");
    }
    setLinkedinConnected(true);
    setLinkedinStep("select");
  };

  const handleActivateLinkedin = async () => {
    const page = linkedinServers.find((p) => p.id === selectedLinkedinPageId);
    if (!page) return;
    applyConnectedIntegration("linkedin", {
      name: page.name,
      metadata: { page_id: page.id, page_name: page.name },
    });
    setLinkedinModalOpen(false);
  };

  // Facebook handlers
  const handleFacebookAuth = () => {
    if (facebookOauthUrl) {
      window.open(facebookOauthUrl, "_blank", "noopener,noreferrer");
    }
    setFacebookConnected(true);
    setFacebookStep("select");
  };

  const handleActivateFacebook = async () => {
    if (facebookConnectionType === "page") {
      const page = facebookTargets.find((p) => p.id === `page:${selectedFacebookPageId}`);
      if (!page) return;
      applyConnectedIntegration("facebook", {
        name: page.name,
        metadata: {
          page_id: selectedFacebookPageId,
          connection_type: "page",
        },
      });
    } else {
      const group = facebookTargets.find((g) => g.id === `group:${selectedFacebookGroupId}`);
      if (!group) return;
      applyConnectedIntegration("facebook", {
        name: group.name,
        metadata: {
          group_id: selectedFacebookGroupId,
          connection_type: "group",
        },
      });
    }
    setFacebookModalOpen(false);
  };

  const formatLastSync = (isoString?: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return t("common.justNow");
    if (diffMins < 60) return t("integrations.minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("integrations.hoursAgo", { count: diffHours });
    return date.toLocaleDateString();
  };

  const whatsappIntegration = getIntegration("whatsapp");
  const discordIntegration = getIntegration("discord");
  const instagramIntegration = getIntegration("instagram");
  const slackIntegration = getIntegration("slack");
  const telegramIntegration = getIntegration("telegram");
  const linkedinIntegration = getIntegration("linkedin");
  const facebookIntegration = getIntegration("facebook");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate("/club-panel")}
          className="shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Link className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("clubPanel.integrations")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("integrations.pageDescription")}
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <FieldLabel className="text-sm text-muted-foreground">
          Active club for integrations
        </FieldLabel>
        <Select
          value={selectedClubId ? String(selectedClubId) : ""}
          onValueChange={(value) => setSelectedClubId(Number(value))}
          disabled={discordLoading || clubs.length === 0}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue placeholder={clubs.length === 0 ? "No clubs found" : "Select club"} />
          </SelectTrigger>
          <SelectContent>
            {clubs.map((club) => (
              <SelectItem key={club.id} value={String(club.id)}>
                {club.club_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {discordError && <p className="text-xs text-error">{discordError}</p>}
      </div>

      {/* Integration Cards */}
      <div className="space-y-4">
        {/* WhatsApp Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <MessageCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("clubPanel.whatsapp")}</h3>
                  {whatsappIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {whatsappIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {whatsappIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(whatsappIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.whatsappScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {whatsappIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("whatsapp")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("whatsapp")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("whatsapp")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Discord Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                <DiscordIcon className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("clubPanel.discord")}</h3>
                  {discordIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {discordIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {discordIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(discordIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.discordScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {discordIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("discord")}
                    disabled={discordLoading || discordSaving || !selectedClubId}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("discord")}
                    disabled={discordLoading || discordSaving || !selectedClubId}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => handleConnect("discord")}
                  disabled={discordLoading || discordSaving || !selectedClubId}
                >
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Instagram Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-linear-to-br from-purple-100 to-pink-100 flex items-center justify-center shrink-0">
                <InstagramIcon className="w-6 h-6 text-pink-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("integrations.instagram")}</h3>
                  {instagramIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {instagramIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {instagramIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(instagramIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.instagramScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {instagramIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("instagram")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("instagram")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("instagram")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Slack Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <SlackIcon className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("integrations.slack")}</h3>
                  {slackIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {slackIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {slackIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(slackIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.slackScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {slackIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("slack")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("slack")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("slack")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Telegram Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                <TelegramIcon className="w-6 h-6 text-sky-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("integrations.telegram")}</h3>
                  {telegramIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {telegramIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {telegramIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(telegramIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.telegramScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {telegramIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("telegram")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("telegram")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("telegram")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* LinkedIn Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <LinkedInIcon className="w-6 h-6 text-blue-700" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("integrations.linkedin")}</h3>
                  {linkedinIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {linkedinIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {linkedinIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(linkedinIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.linkedinScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {linkedinIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("linkedin")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("linkedin")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("linkedin")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Facebook Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <FacebookIcon className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{t("integrations.facebook")}</h3>
                  {facebookIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {facebookIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {facebookIntegration.name}
                      {facebookIntegration.connectionType === "group" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({t("integrations.groupChat")})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(facebookIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.facebookScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {facebookIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("facebook")}
                  >
                    {t("integrations.manage")}
                  </Button>
                    <Button
                      variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("facebook")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("facebook")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Discord Connection Modal */}
      <Dialog open={discordModalOpen} onOpenChange={setDiscordModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectDiscord")}</DialogTitle>
              <DialogDescription>
                {discordStep === "connect"
                  ? t("integrations.discordStep1Desc")
                  : t("integrations.discordStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {discordStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddBot")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addBotDescription")}
                    </p>
                    <Button
                      className="w-full bg-indigo-600 hover:bg-indigo-700"
                      onClick={handleAddToDiscord}
                      disabled={botAdded || discordSaving || !selectedClubId}
                    >
                      {botAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.botAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.addToDiscord")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectChannel")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.server")}
                    </FieldLabel>
                    <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectServer")} />
                      </SelectTrigger>
                      <SelectContent>
                        {discordServers.map((server) => (
                          <SelectItem key={server.id} value={server.id}>
                            {server.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {selectedServerId && (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.channel")}
                      </FieldLabel>
                      <Select
                        value={selectedChannelId}
                        onValueChange={setSelectedChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {discordServers
                            .find((server) => server.id === selectedServerId)
                            ?.channels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>
                              {channel.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.autoPublishNote")}
                    </p>
                  </div>
                </>
              )}

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                {discordStep === "select" && (
                  <Button
                    onClick={handleActivateDiscord}
                    disabled={
                      !selectedServerId ||
                      !selectedChannelId ||
                      discordSaving ||
                      !selectedClubId
                    }
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Connection Modal */}
      <Dialog open={whatsappModalOpen} onOpenChange={setWhatsappModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectWhatsApp")}</DialogTitle>
              <DialogDescription>
                {t("integrations.whatsAppModalDesc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              <div className="flex flex-col items-center py-4">
                <div className="p-4 bg-background rounded-lg border border-border mb-4">
                  <QRCodeSVG
                    value="https://wa.me/message/wat2do-bot-placeholder"
                    size={160}
                    level="M"
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center mb-4">
                  {t("common.or")}
                </p>
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href="https://wa.me/message/wat2do-bot-placeholder"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {t("integrations.openInWhatsApp")}
                  </a>
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  {t("integrations.whatsAppInstructions")}
                </p>
              </div>

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                <Button onClick={handleWhatsAppDone}>
                  {t("common.done")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Instagram Connection Modal */}
      <Dialog open={instagramModalOpen} onOpenChange={setInstagramModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectInstagram")}</DialogTitle>
              <DialogDescription>
                {t("integrations.instagramModalDesc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              <Field>
                <FieldLabel className="text-sm font-medium">
                  {t("integrations.instagramHandle")}
                </FieldLabel>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={instagramHandle}
                    onChange={(e) => setInstagramHandle(e.target.value)}
                    placeholder={t("integrations.instagramHandlePlaceholder")}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("integrations.instagramHandleHelp")}
                </p>
              </Field>

              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {t("integrations.instagramAutoImportNote")}
                </p>
              </div>

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                <Button
                  onClick={handleInstagramConnect}
                  disabled={!instagramHandle}
                >
                  {t("integrations.connect")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Slack Connection Modal */}
      <Dialog open={slackModalOpen} onOpenChange={setSlackModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectSlack")}</DialogTitle>
              <DialogDescription>
                {slackStep === "connect"
                  ? t("integrations.slackStep1Desc")
                  : t("integrations.slackStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {slackStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddApp")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addSlackAppDescription")}
                    </p>
                    <Button
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      onClick={handleAddToSlack}
                      disabled={slackAppAdded}
                    >
                      {slackAppAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.appAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.addToSlack")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectChannel")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.workspace")}
                    </FieldLabel>
                    <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectWorkspace")} />
                      </SelectTrigger>
                      <SelectContent>
                        {slackServers.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {selectedWorkspaceId && (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.channel")}
                      </FieldLabel>
                      <Select
                        value={selectedSlackChannelId}
                        onValueChange={setSelectedSlackChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {slackServers
                            .find((workspace) => workspace.id === selectedWorkspaceId)
                            ?.channels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>
                              {channel.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.slackAutoPublishNote")}
                    </p>
                  </div>
                </>
              )}

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                {slackStep === "select" && (
                  <Button
                    onClick={handleActivateSlack}
                    disabled={!selectedWorkspaceId || !selectedSlackChannelId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Telegram Connection Modal */}
      <Dialog open={telegramModalOpen} onOpenChange={setTelegramModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectTelegram")}</DialogTitle>
              <DialogDescription>
                {telegramStep === "connect"
                  ? t("integrations.telegramStep1Desc")
                  : t("integrations.telegramStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {telegramStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddBot")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addTelegramBotDescription")}
                    </p>
                    <Button
                      className="w-full bg-sky-600 hover:bg-sky-700"
                      onClick={handleAddTelegramBot}
                      disabled={telegramBotAdded}
                    >
                      {telegramBotAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.botAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.addTelegramBot")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectGroup")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.group")}
                    </FieldLabel>
                    <Select value={selectedTelegramGroupId} onValueChange={setSelectedTelegramGroupId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectGroup")} />
                      </SelectTrigger>
                      <SelectContent>
                        {telegramServers.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.telegramAutoPublishNote")}
                    </p>
                  </div>
                </>
              )}

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                {telegramStep === "select" && (
                  <Button
                    onClick={handleActivateTelegram}
                    disabled={!selectedTelegramGroupId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* LinkedIn Connection Modal */}
      <Dialog open={linkedinModalOpen} onOpenChange={setLinkedinModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectLinkedIn")}</DialogTitle>
              <DialogDescription>
                {linkedinStep === "connect"
                  ? t("integrations.linkedinStep1Desc")
                  : t("integrations.linkedinStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {linkedinStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1ConnectAccount")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.linkedinConnectDescription")}
                    </p>
                    <Button
                      className="w-full bg-blue-700 hover:bg-blue-800"
                      onClick={handleLinkedinAuth}
                      disabled={linkedinConnected}
                    >
                      {linkedinConnected ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.accountConnected")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.connectWithLinkedIn")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectPage")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.companyPage")}
                    </FieldLabel>
                    <Select value={selectedLinkedinPageId} onValueChange={setSelectedLinkedinPageId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectPage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {linkedinServers.map((page) => (
                          <SelectItem key={page.id} value={page.id}>
                            {page.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.linkedinAutoPublishNote")}
                    </p>
                  </div>
                </>
              )}

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                {linkedinStep === "select" && (
                  <Button
                    onClick={handleActivateLinkedin}
                    disabled={!selectedLinkedinPageId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Facebook Connection Modal */}
      <Dialog open={facebookModalOpen} onOpenChange={setFacebookModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectFacebook")}</DialogTitle>
              <DialogDescription>
                {facebookStep === "connect"
                  ? t("integrations.facebookStep1Desc")
                  : t("integrations.facebookStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {facebookStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1ConnectAccount")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.facebookConnectDescription")}
                    </p>
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={handleFacebookAuth}
                      disabled={facebookConnected}
                    >
                      {facebookConnected ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.accountConnected")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.connectWithFacebook")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectDestination")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.connectionType")}
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={facebookConnectionType === "page" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          setFacebookConnectionType("page");
                          setSelectedFacebookGroupId("");
                        }}
                      >
                        {t("integrations.facebookPage")}
                      </Button>
                      <Button
                        type="button"
                        variant={facebookConnectionType === "group" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          setFacebookConnectionType("group");
                          setSelectedFacebookPageId("");
                        }}
                      >
                        {t("integrations.facebookGroup")}
                      </Button>
                    </div>
                  </Field>

                  {facebookConnectionType === "page" ? (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.facebookPage")}
                      </FieldLabel>
                      <Select value={selectedFacebookPageId} onValueChange={setSelectedFacebookPageId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectPage")} />
                        </SelectTrigger>
                        <SelectContent>
                          {facebookTargets
                            .filter((target) => target.id.startsWith("page:"))
                            .map((page) => (
                            <SelectItem key={page.id} value={page.id.replace("page:", "")}>
                              {page.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.facebookGroup")}
                      </FieldLabel>
                      <Select value={selectedFacebookGroupId} onValueChange={setSelectedFacebookGroupId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectGroup")} />
                        </SelectTrigger>
                        <SelectContent>
                          {facebookTargets
                            .filter((target) => target.id.startsWith("group:"))
                            .map((group) => (
                            <SelectItem key={group.id} value={group.id.replace("group:", "")}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {facebookConnectionType === "page"
                        ? t("integrations.facebookPageAutoPublishNote")
                        : t("integrations.facebookGroupAutoImportNote")}
                    </p>
                  </div>
                </>
              )}

              <Field orientation="horizontal">
                <DialogClose asChild>
                  <Button variant="outline" type="button">
                    {t("common.cancel")}
                  </Button>
                </DialogClose>
                {facebookStep === "select" && (
                  <Button
                    onClick={handleActivateFacebook}
                    disabled={
                      facebookConnectionType === "page"
                        ? !selectedFacebookPageId
                        : !selectedFacebookGroupId
                    }
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>
    </div>
  );
}
