import type { ApiOrganizationResponse } from "@/shared/generated";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";
import { normalizeOrganization } from "@/features/organizations/api/organizationService";
import type { PaginatedOrganizationsResponse } from "@/features/organizations/api/organizations.api";
import type { Organization } from "@/shared/types";

interface ApiPaginatedOrganizationsResponse {
  items: ApiOrganizationResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function organizationDirectoryTag(school: string): string {
  return `organization-directory-${resolveSchool(school)}`;
}

/** Public organization detail shared by route metadata, initial HTML, and hydration. */
export async function getOrganizationDetailSnapshot(
  organizationId: number,
): Promise<Organization | null> {
  const response = await fetch(
    `${getServerApiBaseUrl()}/organizations/${encodeURIComponent(String(organizationId))}`,
    {
      next: {
        revalidate:
          process.env.NODE_ENV === "development"
            ? 0
            : controlBox.organizationManagement.directoryRevalidateSeconds,
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Organization detail request failed with status ${response.status}`,
    );
  }

  return normalizeOrganization(
    (await response.json()) as ApiOrganizationResponse,
  );
}

export async function getOrganizationDirectorySnapshot(
  school: string,
): Promise<PaginatedOrganizationsResponse> {
  const resolvedSchool = resolveSchool(school);
  return fetchOrganizationDirectoryPage(resolvedSchool, 1);
}

async function fetchOrganizationDirectoryPage(
  school: string,
  page: number,
): Promise<PaginatedOrganizationsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(controlBox.organizationManagement.directoryPageSize),
    school,
  });
  const response = await fetch(
    `${getServerApiBaseUrl()}/organizations/?${params.toString()}`,
    {
      next: {
        revalidate:
          process.env.NODE_ENV === "development"
            ? 0
            : controlBox.organizationManagement.directoryRevalidateSeconds,
        tags: [organizationDirectoryTag(school)],
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Organization directory request failed with status ${response.status}`,
    );
  }

  const directory = (await response.json()) as ApiPaginatedOrganizationsResponse;
  return {
    ...directory,
    items: directory.items.map(normalizeOrganization),
  };
}

/** Every approved organization for server-rendered public discovery surfaces. */
export async function getAllOrganizationDirectorySnapshot(
  school: string,
): Promise<Organization[]> {
  const resolvedSchool = resolveSchool(school);
  const firstPage = await fetchOrganizationDirectoryPage(resolvedSchool, 1);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      fetchOrganizationDirectoryPage(resolvedSchool, index + 2),
    ),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}
