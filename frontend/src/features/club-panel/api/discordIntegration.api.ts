import { api } from "@/shared/services/apiClient";

export interface DiscordChannelOption {
  id: string;
  name: string;
}

export interface DiscordServerOption {
  id: string;
  name: string;
  channels: DiscordChannelOption[];
}

export interface DiscordIntegrationOptionsResponse {
  oauth_url: string;
  servers: DiscordServerOption[];
}

export interface DiscordIntegrationResponse {
  club_id: number;
  connected: boolean;
  name: string | null;
  server_id: string | null;
  server_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  last_sync: string | null;
}

export async function getDiscordIntegrationOptions(): Promise<DiscordIntegrationOptionsResponse> {
  return api.get<DiscordIntegrationOptionsResponse>("/clubs/integrations/discord/options");
}

export async function getDiscordIntegration(clubId: number): Promise<DiscordIntegrationResponse> {
  return api.get<DiscordIntegrationResponse>(`/clubs/${clubId}/integrations/discord`);
}

export async function connectDiscordIntegration(
  clubId: number,
  payload: {
    connected: boolean;
    server_id: string;
    server_name: string;
    channel_id: string;
    channel_name: string;
  }
): Promise<DiscordIntegrationResponse> {
  return api.put<DiscordIntegrationResponse>(`/clubs/${clubId}/integrations/discord`, payload);
}

export async function disconnectDiscordIntegration(clubId: number): Promise<DiscordIntegrationResponse> {
  return api.delete<DiscordIntegrationResponse>(`/clubs/${clubId}/integrations/discord`);
}
