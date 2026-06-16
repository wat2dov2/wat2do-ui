import { api } from "@/shared/services/apiClient";

export interface OrganizationMember {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: number;
  email: string;
  token: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export interface OrganizationInvitationPublic {
  organization_name: string;
  email: string;
  expires_at: string;
}

export async function fetchOrganizationMembers(organizationId: number): Promise<OrganizationMember[]> {
  return api.get<OrganizationMember[]>(`/organizations/${organizationId}/members`);
}

export async function addOrganizationMember(organizationId: number, email: string): Promise<OrganizationMember | OrganizationInvitation> {
  return api.post<OrganizationMember | OrganizationInvitation>(`/organizations/${organizationId}/members`, { email });
}

export async function removeOrganizationMember(organizationId: number, userId: string): Promise<void> {
  return api.delete<void>(`/organizations/${organizationId}/members/${userId}`);
}

export async function fetchOrganizationInvitations(organizationId: number): Promise<OrganizationInvitation[]> {
  return api.get<OrganizationInvitation[]>(`/organizations/${organizationId}/invitations`);
}

export async function revokeOrganizationInvitation(organizationId: number, invitationId: string): Promise<void> {
  return api.delete<void>(`/organizations/${organizationId}/invitations/${invitationId}`);
}

export async function getInvitationByToken(token: string): Promise<OrganizationInvitationPublic> {
  return api.get<OrganizationInvitationPublic>(`/organizations/invitations/${token}`);
}

export async function acceptInvitationByToken(token: string): Promise<void> {
  return api.post<void>(`/organizations/invitations/${token}/accept`);
}
