import { api } from "@/shared/services/apiClient";

export interface OrganizationMembership {
  id: string;
  organization_id: number;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  role: "member" | "officer" | "owner";
  created_at: string;
  updated_at: string;
}

export interface UserMin {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

export interface OrganizationMembershipWithUser extends OrganizationMembership {
  user: UserMin;
}

export async function requestToJoinOrganization(organizationId: number): Promise<OrganizationMembership> {
  return api.post<OrganizationMembership>(`/organizations/${organizationId}/join`);
}

export async function leaveOrganizationOrCancelRequest(organizationId: number): Promise<void> {
  await api.delete(`/organizations/${organizationId}/membership`);
}

export async function getMyMembershipStatus(organizationId: number): Promise<OrganizationMembership | null> {
  return api.get<OrganizationMembership | null>(`/organizations/${organizationId}/membership`);
}

export async function listOrganizationMemberships(
  organizationId: number,
  status?: "pending" | "approved" | "rejected"
): Promise<OrganizationMembershipWithUser[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  return api.get<OrganizationMembershipWithUser[]>(`/organizations/${organizationId}/memberships?${params.toString()}`);
}

export async function updateOrganizationMembership(
  organizationId: number,
  userId: string,
  data: { status: "pending" | "approved" | "rejected"; role?: "member" | "officer" | "owner" }
): Promise<OrganizationMembership> {
  return api.patch<OrganizationMembership>(`/organizations/${organizationId}/memberships/${userId}`, data);
}

export async function removeOrganizationMembership(organizationId: number, userId: string): Promise<void> {
  await api.delete(`/organizations/${organizationId}/memberships/${userId}`);
}
