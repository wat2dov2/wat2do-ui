import { api } from "@/shared/services/apiClient";
import type {
  ApiOrganizationIntegrationResponse,
  ApiDiscordChannelOption,
  ApiDiscordServerOption,
} from "@/shared/generated";
import type { components } from "@/shared/generated/api-types";

export type IntegrationPlatform = ApiOrganizationIntegrationResponse["platform"];

export type IntegrationChannelOption = ApiDiscordChannelOption;

export type IntegrationServerOption = ApiDiscordServerOption;

export type IntegrationOptionsResponse = components["schemas"]["PlatformIntegrationOptionsResponse"];

export type PlatformIntegrationResponse = ApiOrganizationIntegrationResponse;

export async function getIntegrationOptions(
  platform: IntegrationPlatform
): Promise<IntegrationOptionsResponse> {
  return api.get<IntegrationOptionsResponse>(`/organizations/integrations/${platform}/options`);
}

export async function getPlatformIntegration(
  organizationId: number,
  platform: IntegrationPlatform
): Promise<PlatformIntegrationResponse> {
  return api.get<PlatformIntegrationResponse>(`/organizations/${organizationId}/integrations/${platform}`);
}

export async function connectPlatformIntegration(
  organizationId: number,
  platform: IntegrationPlatform,
  payload: {
    connected: boolean;
    name?: string;
    metadata?: Record<string, string>;
  }
): Promise<PlatformIntegrationResponse> {
  return api.put<PlatformIntegrationResponse>(`/organizations/${organizationId}/integrations/${platform}`, payload);
}

export async function disconnectPlatformIntegration(
  organizationId: number,
  platform: IntegrationPlatform
): Promise<PlatformIntegrationResponse> {
  return api.delete<PlatformIntegrationResponse>(`/organizations/${organizationId}/integrations/${platform}`);
}
