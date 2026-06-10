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

function normalizeOrganization(raw: ApiClubResponse): Organization {
  return {
    ...raw,
    categories: raw.categories ?? [],
    club_page: raw.club_page ?? "",
    ig: raw.ig ?? null,
    discord: raw.discord ?? null,
    logo_url: raw.logo_url ?? null,
    created_by: raw.created_by ?? null,
    school: raw.school ?? "",
  };
}

export async function getAllOrganizations(school?: string): Promise<Organization[]> {
  const params = new URLSearchParams();
  params.set("limit", String(ORGANIZATIONS_LIST_LIMIT));
  if (school) {
    params.set("school", school);
  }
  const rawOrgs = await api.get<ApiClubResponse[]>(`/clubs/?${params.toString()}`);
  return rawOrgs.map(normalizeOrganization);
}

export async function getMyOrganizations(): Promise<Organization[]> {
  const rawOrgs = await api.get<ApiClubResponse[]>("/clubs/mine");
  return rawOrgs.map(normalizeOrganization);
}

export async function createOrganizationAPI(organizationData: Omit<Organization, "id">): Promise<Organization> {
  const { created_by, ...payload } = organizationData;
  const raw = await api.post<ApiClubResponse>("/clubs/", {
    ...payload,
    owner_user_id: created_by || undefined,
  });
  return normalizeOrganization(raw);
}

export async function updateOrganizationAPI(
  organization: Organization,
  updates: Partial<Omit<Organization, "id">>,
): Promise<Organization> {
  const payload = { ...updates };
  delete payload.created_by;
  const updated = await api.patch<ApiClubResponse>(`/clubs/${organization.id}`, payload);
  return normalizeOrganization(updated);
}

export async function deleteOrganizationAPI(organizationId: number): Promise<void> {
  await api.delete(`/clubs/${organizationId}`);
}

export function filterOrganizations(
  organizations: Organization[],
  options: { categories?: string[]; organizationType?: string; searchQuery?: string },
): Organization[] {
  let filtered = organizations;
  if (options.searchQuery) filtered = filterOrganizationsBySearch(filtered, options.searchQuery);
  if (options.categories?.length) filtered = filterOrganizationsByCategory(filtered, options.categories);
  if (options.organizationType) filtered = filterOrganizationsByType(filtered, options.organizationType);
  return filtered;
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

export async function loadOrganizationsData(school?: string): Promise<Organization[]> {
  return getAllOrganizations(school);
}

// --- Backend-synced saved/followed organizations ---

export async function fetchSavedOrganizationIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-clubs/");
}

export async function saveOrganizationToBackend(organizationId: number): Promise<void> {
  await api.put<void>(`/saved-clubs/${organizationId}`);
}

export async function unsaveOrganizationToBackend(organizationId: number): Promise<void> {
  await api.delete(`/saved-clubs/${organizationId}`);
}
