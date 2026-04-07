import { api } from "@/shared/services/apiClient";
import type {
  ApiDiscordChannelOption,
  ApiDiscordServerOption,
  ApiDiscordIntegrationOptionsResponse,
  ApiDiscordIntegrationResponse,
} from "@/shared/generated";

export type DiscordChannelOption = ApiDiscordChannelOption;
export type DiscordServerOption = ApiDiscordServerOption;
export type DiscordIntegrationOptionsResponse = ApiDiscordIntegrationOptionsResponse;
export type DiscordIntegrationResponse = ApiDiscordIntegrationResponse;

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
