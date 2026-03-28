import { api } from "@/shared/services/apiClient";

export type IntegrationPlatform =
  | "whatsapp"
  | "discord"
  | "instagram"
  | "slack"
  | "telegram"
  | "linkedin"
  | "facebook";

export interface IntegrationChannelOption {
  id: string;
  name: string;
}

export interface IntegrationServerOption {
  id: string;
  name: string;
  channels: IntegrationChannelOption[];
}

export interface IntegrationOptionsResponse {
  oauth_url: string | null;
  servers: IntegrationServerOption[];
}

export interface PlatformIntegrationResponse {
  club_id: number;
  platform: IntegrationPlatform;
  connected: boolean;
  name: string | null;
  last_sync: string | null;
  metadata: Record<string, string>;
}

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
  payload: {
    connected: boolean;
    name?: string;
    metadata?: Record<string, string>;
  }
): Promise<PlatformIntegrationResponse> {
  return api.put<PlatformIntegrationResponse>(`/clubs/${clubId}/integrations/${platform}`, payload);
}

export async function disconnectPlatformIntegration(
  clubId: number,
  platform: IntegrationPlatform
): Promise<PlatformIntegrationResponse> {
  return api.delete<PlatformIntegrationResponse>(`/clubs/${clubId}/integrations/${platform}`);
}
