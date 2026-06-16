import { api } from "@/shared/services/apiClient";

export interface OrganizationJoinRequest {
  id: string;
  organization_id: number;
  user_id: string;
  pitch: string;
  status: string;
  created_at: string;
  updated_at: string;
  users?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export async function fetchJoinRequests(organizationId: number): Promise<OrganizationJoinRequest[]> {
  return api.get<OrganizationJoinRequest[]>(`/organizations/${organizationId}/join-requests`);
}

export async function resolveJoinRequest(
  organizationId: number,
  requestId: string,
  status: "approved" | "rejected"
): Promise<OrganizationJoinRequest> {
  return api.patch<OrganizationJoinRequest>(`/organizations/${organizationId}/join-requests/${requestId}`, {
    status,
  });
}
