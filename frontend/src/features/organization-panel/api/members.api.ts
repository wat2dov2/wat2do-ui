import { api } from "@/shared/services/apiClient";

export interface ClubMember {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface ClubInvitation {
  id: string;
  club_id: number;
  email: string;
  token: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export interface ClubInvitationPublic {
  club_name: string;
  email: string;
  expires_at: string;
}

export async function fetchClubMembers(clubId: number): Promise<ClubMember[]> {
  return api.get<ClubMember[]>(`/clubs/${clubId}/members`);
}

export async function addClubMember(clubId: number, email: string): Promise<ClubMember | ClubInvitation> {
  return api.post<ClubMember | ClubInvitation>(`/clubs/${clubId}/members`, { email });
}

export async function removeClubMember(clubId: number, userId: string): Promise<void> {
  return api.delete<void>(`/clubs/${clubId}/members/${userId}`);
}

export async function fetchClubInvitations(clubId: number): Promise<ClubInvitation[]> {
  return api.get<ClubInvitation[]>(`/clubs/${clubId}/invitations`);
}

export async function revokeClubInvitation(clubId: number, invitationId: string): Promise<void> {
  return api.delete<void>(`/clubs/${clubId}/invitations/${invitationId}`);
}

export async function getInvitationByToken(token: string): Promise<ClubInvitationPublic> {
  return api.get<ClubInvitationPublic>(`/clubs/invitations/${token}`);
}

export async function acceptInvitationByToken(token: string): Promise<void> {
  return api.post<void>(`/clubs/invitations/${token}/accept`);
}

