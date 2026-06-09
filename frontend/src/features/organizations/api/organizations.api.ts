/**
 * Organizations API
 * All organizations come from the backend. No mock/static data.
 */

import type { Organization } from "@/shared/types";
import type { ApiClubResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";
import {
  filterOrganizationsBySearch,
  filterOrganizationsByCategory,
  filterOrganizationsByType,
} from "@/features/organizations/api/organizationService";

const ORGANIZATIONS_LIST_LIMIT = 500;

function normalizeOrganization(club: ApiClubResponse): Organization {
  return {
    ...club,
    categories: club.categories ?? [],
    club_page: club.club_page ?? "",
    ig: club.ig ?? null,
    discord: club.discord ?? null,
    logo_url: club.logo_url ?? null,
    created_by: club.created_by ?? null,
    school: club.school ?? "",
  };
}

export async function getAllOrganizations(school?: string): Promise<Organization[]> {
  const params = new URLSearchParams();
  params.set("limit", String(ORGANIZATIONS_LIST_LIMIT));
  if (school) {
    params.set("school", school);
  }
  const clubs = await api.get<ApiClubResponse[]>(`/clubs/?${params.toString()}`);
  return clubs.map(normalizeOrganization);
}

export async function getMyOrganizations(): Promise<Organization[]> {
  const clubs = await api.get<ApiClubResponse[]>("/clubs/mine");
  return clubs.map(normalizeOrganization);
}

export async function createOrganizationAPI(clubData: Omit<Organization, "id">): Promise<Organization> {
  const { created_by, ...payload } = clubData;
  const club = await api.post<ApiClubResponse>("/clubs/", {
    ...payload,
    owner_user_id: created_by || undefined,
  });
  return normalizeOrganization(club);
}

export async function updateOrganizationAPI(
  club: Organization,
  clubData: Partial<Omit<Organization, "id">>,
): Promise<Organization> {
  const payload = { ...clubData };
  delete payload.created_by;
  const updated = await api.patch<ApiClubResponse>(`/clubs/${club.id}`, payload);
  return normalizeOrganization(updated);
}

export async function deleteOrganizationAPI(clubId: number): Promise<void> {
  await api.delete(`/clubs/${clubId}`);
}

export function filterOrganizations(
  organizations: Organization[],
  options: { categories?: string[]; clubType?: string; searchQuery?: string },
): Organization[] {
  let filtered = organizations;
  if (options.searchQuery) filtered = filterOrganizationsBySearch(filtered, options.searchQuery);
  if (options.categories?.length) filtered = filterOrganizationsByCategory(filtered, options.categories);
  if (options.clubType) filtered = filterOrganizationsByType(filtered, options.clubType);
  return filtered;
}

async function getOrganizationCategories(existingOrganizations?: Organization[]): Promise<string[]> {
  const organizations = existingOrganizations ?? await getAllOrganizations();
  const cats = new Set<string>();
  organizations.forEach((c) => c.categories.forEach((cat) => cats.add(cat)));
  return Array.from(cats).sort();
}

export async function getOrganizationTypes(existingOrganizations?: Organization[]): Promise<string[]> {
  const organizations = existingOrganizations ?? await getAllOrganizations();
  const types = new Set<string>();
  organizations.forEach((c) => {
    const type = c.club_type?.trim() ?? "";
    if (type) types.add(type);
  });
  return Array.from(types).sort();
}

export async function loadOrganizationsData(school?: string): Promise<{ organizations: Organization[]; categories: string[] }> {
  const organizations = await getAllOrganizations(school);
  const categories = await getOrganizationCategories(organizations);
  return { organizations, categories };
}

// --- Backend-synced saved/followed organizations ---

export async function fetchSavedOrganizationIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-clubs/");
}

export async function saveOrganizationToBackend(clubId: number): Promise<void> {
  await api.put<void>(`/saved-clubs/${clubId}`);
}

export async function unsaveOrganizationToBackend(clubId: number): Promise<void> {
  await api.delete(`/saved-clubs/${clubId}`);
}
