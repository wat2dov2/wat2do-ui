/**
 * Clubs API
 * All clubs come from the backend. No mock/static data.
 */

import type { Club } from "@/shared/types";
import type { ApiClubResponse, ApiPaginatedClubsResponse } from "@/shared/generated";
import { api, getPaginatedItems } from "@/shared/services/apiClient";
import { normalizeClub } from "@/features/clubs/api/clubService";

export async function getAllClubs(school?: string): Promise<Club[]> {
  const params = new URLSearchParams();
  if (school) {
    params.set("school", school);
  }
  const url = `/clubs/${params.toString() ? `?${params.toString()}` : ""}`;
  const rawOrgs = await getPaginatedItems<ApiClubResponse>(url);
  return rawOrgs.map(normalizeClub);
}

export type PaginatedClubsResponse = Omit<ApiPaginatedClubsResponse, "items"> & {
  items: Club[];
};

export async function getClubsPaginated(options: {
  page: number;
  limit: number;
  search?: string;
  clubType?: string;
}): Promise<PaginatedClubsResponse> {
  const params = new URLSearchParams();
  params.set("page", String(options.page));
  params.set("page_size", String(options.limit));
  if (options.search) {
    params.set("search", options.search);
  }
  if (options.clubType) {
    params.set("club_type", options.clubType);
  }

  const response = await api.get<ApiPaginatedClubsResponse>(`/clubs/?${params.toString()}`);
  return {
    items: response.items.map(normalizeClub),
    total: response.total,
    page: response.page,
    page_size: response.page_size,
    total_pages: response.total_pages,
  };
}

export async function getMyClubs(): Promise<Club[]> {
  const rawOrgs = await api.get<ApiClubResponse[]>("/clubs/mine");
  return rawOrgs.map(normalizeClub);
}

export async function getClubById(
  clubId: number,
): Promise<Club> {
  const raw = await api.get<ApiClubResponse>(
    `/clubs/${clubId}`,
  );
  return normalizeClub(raw);
}

type ClubCreateInput = Pick<
  Club,
  | "club_name"
  | "categories"
  | "club_page"
  | "ig"
  | "discord"
  | "club_type"
  | "logo_url"
  | "school"
>;

export async function createClubAPI(
  clubData: ClubCreateInput,
): Promise<Club> {
  const raw = await api.post<ApiClubResponse>("/clubs/", clubData);
  return normalizeClub(raw);
}

export async function updateClubAPI(
  club: Club,
  updates: Partial<Omit<Club, "id">>,
): Promise<Club> {
  const payload = { ...updates };
  delete payload.created_by;
  const updated = await api.patch<ApiClubResponse>(`/clubs/${club.id}`, payload);
  return normalizeClub(updated);
}

export async function deleteClubAPI(clubId: number): Promise<void> {
  await api.delete(`/clubs/${clubId}`);
}

// --- Backend-synced saved/followed clubs ---

export async function fetchSavedClubIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-clubs/");
}

export async function saveClubToBackend(clubId: number): Promise<void> {
  await api.put<void>(`/saved-clubs/${clubId}`);
}

export async function unsaveClubToBackend(clubId: number): Promise<void> {
  await api.delete(`/saved-clubs/${clubId}`);
}
