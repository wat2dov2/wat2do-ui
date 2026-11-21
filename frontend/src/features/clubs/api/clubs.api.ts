/**
 * Clubs API
 * All clubs come from the backend. No mock/static data.
 */

import type { Club } from "@/shared/types";
import type {
  ApiClubClaimLinkResponse,
  ApiClubExistsResponse,
  ApiClubResponse,
  ApiPaginatedClubsResponse,
} from "@/shared/generated";
import { api, isApiError } from "@/shared/services/apiClient";
import { normalizeClub } from "@/features/clubs/api/clubService";
import { getSessionEmail } from "@/features/auth/api/auth.api";
import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import { resolveSchool } from "@/shared/constants/schools";
import { fetchDiscoverySnapshot, preserveDiscoveryGeneration, type DiscoverySnapshotMetadata } from "@/shared/api/discovery.api";

export function clubDirectoryQueryOptions(school: string | null | undefined) {
  const resolvedSchool = resolveSchool(school);
  return queryOptions({
    queryKey: queryKeys.clubs.allForSchool(resolvedSchool),
    queryFn: () => fetchDiscoverySnapshot<PaginatedClubsResponse>(resolvedSchool, "clubs"),
    structuralSharing: preserveDiscoveryGeneration,
    retry: false,
  });
}

export type PaginatedClubsResponse = Omit<ApiPaginatedClubsResponse, "items"> & DiscoverySnapshotMetadata & {
  items: Club[];
};

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

/** Submits a club as the signed-in account, which hears back when it is reviewed. */
export async function createClubAPI(
  clubData: ClubCreateInput,
): Promise<Club> {
  const raw = await api.post<ApiClubResponse>("/clubs/", {
    ...clubData,
    submitted_by_email: getSessionEmail(),
  });
  return normalizeClub(raw);
}

/** The club a create or edit was refused for: the school already lists a club with that Instagram account. */
export function existingClubFromError(error: unknown): ApiClubExistsResponse | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const body = error.body as Partial<ApiClubExistsResponse> | null;
  return typeof body?.club_id === "number" ? (body as ApiClubExistsResponse) : null;
}

export async function updateClubAPI(
  club: Club,
  updates: Partial<Omit<Club, "id">>,
): Promise<Club> {
  const updated = await api.patch<ApiClubResponse>(`/clubs/${club.id}`, updates);
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

/** The club an outreach email's claim link hands over, while nobody manages it. */
export type ClubClaimLink = ApiClubClaimLinkResponse;

export function claimLinkQueryOptions(token: string) {
  return queryOptions({
    queryKey: queryKeys.clubs.claimLink(token),
    queryFn: () => api.get<ClubClaimLink>(`/clubs/claim-links/${token}`),
    retry: false,
  });
}

/** Makes the signed-in user the owner of the club the claim link hands over. */
export async function acceptClaimLink(token: string): Promise<ClubClaimLink> {
  return api.post<ClubClaimLink>(`/clubs/claim-links/${token}/accept`);
}
