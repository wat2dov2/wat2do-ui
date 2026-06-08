import { api } from "@/shared/services/apiClient";

export interface ClubJoinRequest {
  id: string;
  club_id: number;
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

export async function fetchJoinRequests(clubId: number): Promise<ClubJoinRequest[]> {
  return api.get<ClubJoinRequest[]>(`/clubs/${clubId}/join-requests`);
}

export async function resolveJoinRequest(
  clubId: number,
  requestId: string,
  status: "approved" | "rejected"
): Promise<ClubJoinRequest> {
  return api.patch<ClubJoinRequest>(`/clubs/${clubId}/join-requests/${requestId}`, {
    status,
  });
}
