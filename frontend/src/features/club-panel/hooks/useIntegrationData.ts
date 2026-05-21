import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import type { Club } from "@/shared/types";
import { ApiError } from "@/shared/services/apiClient";
import { getAllClubs } from "@/features/clubs";
import {
  getIntegrationOptions,
  getPlatformIntegration,
  type IntegrationPlatform,
  type IntegrationServerOption,
} from "@/features/club-panel/api/integrations.api";

// --- Platform options state ---

export interface PlatformOptions {
  slackServers: IntegrationServerOption[];
  telegramServers: IntegrationServerOption[];
  linkedinServers: IntegrationServerOption[];
  facebookTargets: IntegrationServerOption[];
  discordServers: IntegrationServerOption[];
  discordOauthUrl: string;
  slackOauthUrl: string;
  linkedinOauthUrl: string;
  facebookOauthUrl: string;
}

const initialPlatformOptions: PlatformOptions = {
  slackServers: [],
  telegramServers: [],
  linkedinServers: [],
  facebookTargets: [],
  discordServers: [],
  discordOauthUrl: "",
  slackOauthUrl: "",
  linkedinOauthUrl: "",
  facebookOauthUrl: "",
};

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

export function mapResponseToIntegration(
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

/**
 * Manages data loading for integrations: clubs, platform options, and
 * per-club integration state. Separated from connection management logic.
 */
export function useIntegrationData() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Core data
  const [integrations, setIntegrations] = useState<Integration[]>(buildInitialIntegrations);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);

  // Platform options (loaded once at boot)
  const [options, setOptions] = useState<PlatformOptions>(initialPlatformOptions);

  // Loading / error
  const [loading, setLoading] = useState(false);
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
    let cancelled = false;
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
        if (cancelled) return;
        setClubs(clubsData);
        setOptions({
          discordServers: discordOptions.servers,
          slackServers: slackOptions.servers,
          telegramServers: telegramOptions.servers,
          linkedinServers: linkedinOptions.servers,
          facebookTargets: facebookOptions.servers,
          discordOauthUrl: discordOptions.oauth_url ?? "",
          slackOauthUrl: slackOptions.oauth_url ?? "",
          linkedinOauthUrl: linkedinOptions.oauth_url ?? "",
          facebookOauthUrl: facebookOptions.oauth_url ?? "",
        });
        if (clubsData.length > 0) {
          setSelectedClubId((prev) => prev ?? clubsData[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load integration settings:", err);
        if (redirectIfUnauthorized(err)) return;
        setError(t("integrations.errors.loadSettingsFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadBootData();
    return () => {
      cancelled = true;
    };
  }, [redirectIfUnauthorized, t]);

  // --- Load integrations for selected club ---
  useEffect(() => {
    if (!selectedClubId) return;
    let cancelled = false;
    const loadIntegrations = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await Promise.all(
          ALL_PLATFORMS.map((platform) => getPlatformIntegration(selectedClubId, platform))
        );
        if (cancelled) return;
        const byPlatform = new Map(data.map((row) => [row.platform, row]));
        setIntegrations(
          ALL_PLATFORMS.map((platform) => {
            const row = byPlatform.get(platform);
            if (!row) return { platform, connected: false };
            return mapResponseToIntegration(platform, row);
          })
        );
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load integrations:", err);
        if (redirectIfUnauthorized(err)) return;
        setError(t("integrations.errors.loadIntegrationsFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadIntegrations();
    return () => {
      cancelled = true;
    };
  }, [selectedClubId, redirectIfUnauthorized, t]);

  const getIntegration = (platform: IntegrationPlatform) =>
    integrations.find((i) => i.platform === platform);

  return {
    integrations,
    setIntegrations,
    clubs,
    selectedClubId,
    setSelectedClubId,
    options,
    loading,
    error,
    setError,
    redirectIfUnauthorized,
    getIntegration,
  };
}
