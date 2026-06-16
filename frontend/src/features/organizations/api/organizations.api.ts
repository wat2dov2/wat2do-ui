/**
 * Organizations API
 * All organizations come from the backend. No mock/static data.
 */

import type { Organization } from "@/shared/types";
import type { ApiOrganizationResponse } from "@/shared/generated";
import { api, getPaginatedItems } from "@/shared/services/apiClient";
import {
  filterOrganizationsBySearch,
  filterOrganizationsByCategory,
  filterOrganizationsByType,
} from "@/features/organizations/api/organizationService";



function normalizeOrganization(raw: ApiOrganizationResponse): Organization {
  return {
    ...raw,
    categories: raw.categories ?? [],
    organization_page: raw.organization_page ?? "",
    ig: raw.ig ?? null,
    discord: raw.discord ?? null,
    logo_url: raw.logo_url ?? null,
    created_by: raw.created_by ?? null,
    school: raw.school ?? "",
  };
}

export async function getAllOrganizations(school?: string): Promise<Organization[]> {
  const params = new URLSearchParams();
  if (school) {
    params.set("school", school);
  }
  const url = `/organizations/${params.toString() ? `?${params.toString()}` : ""}`;
  const rawOrgs = await getPaginatedItems<ApiOrganizationResponse>(url);
  return rawOrgs.map(normalizeOrganization);
}

export interface PaginatedOrganizationsResponse {
  items: Organization[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export async function getOrganizationsPaginated(options: {
  page: number;
  limit: number;
  school?: string;
  search?: string;
  categories?: string[];
  organizationType?: string;
  ids?: number[];
}): Promise<PaginatedOrganizationsResponse> {
  const params = new URLSearchParams();
  params.set("page", String(options.page));
  params.set("page_size", String(options.limit));
  if (options.school) {
    params.set("school", options.school);
  }
  if (options.search) {
    params.set("search", options.search);
  }
  if (options.organizationType) {
    params.set("organization_type", options.organizationType);
  }
  if (options.categories && options.categories.length > 0) {
    options.categories.forEach((cat) => params.append("categories", cat));
  }
  if (options.ids && options.ids.length > 0) {
    options.ids.forEach((id) => params.append("ids", String(id)));
  }

  interface PaginatedResponse {
    items: ApiOrganizationResponse[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  }

  const response = await api.get<PaginatedResponse>(`/organizations/?${params.toString()}`);
  return {
    items: response.items.map(normalizeOrganization),
    total: response.total,
    page: response.page,
    page_size: response.page_size,
    total_pages: response.total_pages,
  };
}

export async function getMyOrganizations(): Promise<Organization[]> {
  const rawOrgs = await api.get<ApiOrganizationResponse[]>("/organizations/mine");
  return rawOrgs.map(normalizeOrganization);
}

export async function createOrganizationAPI(organizationData: Omit<Organization, "id">): Promise<Organization> {
  const { created_by, ...payload } = organizationData;
  const raw = await api.post<ApiOrganizationResponse>("/organizations/", {
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
  const updated = await api.patch<ApiOrganizationResponse>(`/organizations/${organization.id}`, payload);
  return normalizeOrganization(updated);
}

export async function deleteOrganizationAPI(organizationId: number): Promise<void> {
  await api.delete(`/organizations/${organizationId}`);
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
    const type = c.organization_type?.trim() ?? "";
    if (type) types.add(type);
  });
  return Array.from(types).sort();
}

// --- Backend-synced saved/followed organizations ---

export async function fetchSavedOrganizationIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-organizations/");
}

export async function saveOrganizationToBackend(organizationId: number): Promise<void> {
  await api.put<void>(`/saved-organizations/${organizationId}`);
}

export async function unsaveOrganizationToBackend(organizationId: number): Promise<void> {
  await api.delete(`/saved-organizations/${organizationId}`);
}
