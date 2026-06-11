import { api } from "@/shared/services/apiClient";

export interface OrganizationMembership {
  id: string;
  club_id: number;
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
  return api.post<OrganizationMembership>(`/clubs/${organizationId}/join`);
}

export async function leaveOrganizationOrCancelRequest(organizationId: number): Promise<void> {
  await api.delete(`/clubs/${organizationId}/membership`);
}

export async function getMyMembershipStatus(organizationId: number): Promise<OrganizationMembership | null> {
  return api.get<OrganizationMembership | null>(`/clubs/${organizationId}/membership`);
}

export async function listOrganizationMemberships(
  organizationId: number,
  status?: "pending" | "approved" | "rejected"
): Promise<OrganizationMembershipWithUser[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  return api.get<OrganizationMembershipWithUser[]>(`/clubs/${organizationId}/memberships?${params.toString()}`);
}

export async function updateOrganizationMembership(
  organizationId: number,
  userId: string,
  data: { status: "pending" | "approved" | "rejected"; role?: "member" | "officer" | "owner" }
): Promise<OrganizationMembership> {
  return api.patch<OrganizationMembership>(`/clubs/${organizationId}/memberships/${userId}`, data);
}

export async function removeOrganizationMember(organizationId: number, userId: string): Promise<void> {
  await api.delete(`/clubs/${organizationId}/memberships/${userId}`);
}
