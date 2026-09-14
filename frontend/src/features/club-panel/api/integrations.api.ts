import { api } from "@/shared/services/apiClient";
import type {
  ApiClubIntegrationResponse,
  ApiDiscordChannelOption,
  ApiDiscordServerOption,
} from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";

export type IntegrationPlatform = ApiClubIntegrationResponse["platform"];

export type IntegrationChannelOption = ApiDiscordChannelOption;

export type IntegrationServerOption = ApiDiscordServerOption;

type IntegrationOptionsResponse = components["schemas"]["PlatformIntegrationOptionsResponse"];

export type PlatformIntegrationResponse = ApiClubIntegrationResponse;

export async function getIntegrationOptions(
  platform: IntegrationPlatform
): Promise<IntegrationOptionsResponse> {
  return api.get<IntegrationOptionsResponse>(`/clubs/integrations/${platform}/options`);
}

export async function getPlatformIntegration(
  clubId: number,
  platform: IntegrationPlatform
): Promise<PlatformIntegrationResponse> {
  return api.get<PlatformIntegrationResponse>(`/clubs/${clubId}/integrations/${platform}`);
}

export async function connectPlatformIntegration(
  clubId: number,
  platform: IntegrationPlatform,
  payload: components["schemas"]["ClubIntegrationUpdate"]
): Promise<PlatformIntegrationResponse> {
  return api.put<PlatformIntegrationResponse>(`/clubs/${clubId}/integrations/${platform}`, payload);
}

export async function disconnectPlatformIntegration(
  clubId: number,
  platform: IntegrationPlatform
): Promise<PlatformIntegrationResponse> {
  return api.delete<PlatformIntegrationResponse>(`/clubs/${clubId}/integrations/${platform}`);
}
