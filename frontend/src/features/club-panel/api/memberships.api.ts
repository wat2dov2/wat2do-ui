import { api } from "@/shared/services/apiClient";

export interface ClubMembership {
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

export interface ClubMembershipWithUser extends ClubMembership {
  user: UserMin;
}

export async function requestToJoinClub(clubId: number): Promise<ClubMembership> {
  return api.post<ClubMembership>(`/clubs/${clubId}/join`);
}

export async function leaveClubOrCancelRequest(clubId: number): Promise<void> {
  await api.delete(`/clubs/${clubId}/membership`);
}

export async function getMyMembershipStatus(clubId: number): Promise<ClubMembership | null> {
  return api.get<ClubMembership | null>(`/clubs/${clubId}/membership`);
}

export async function listClubMemberships(
  clubId: number,
  status?: "pending" | "approved" | "rejected"
): Promise<ClubMembershipWithUser[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  return api.get<ClubMembershipWithUser[]>(`/clubs/${clubId}/memberships?${params.toString()}`);
}

export async function updateClubMembership(
  clubId: number,
  userId: string,
  data: { status: "pending" | "approved" | "rejected"; role?: "member" | "officer" | "owner" }
): Promise<ClubMembership> {
  return api.patch<ClubMembership>(`/clubs/${clubId}/memberships/${userId}`, data);
}

export async function removeClubMember(clubId: number, userId: string): Promise<void> {
  await api.delete(`/clubs/${clubId}/memberships/${userId}`);
}
