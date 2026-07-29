import { headers } from "next/headers";
import { OrganizationsRoute } from "@/app/client-routes";
import { getOrganizationDirectorySnapshot } from "@/features/organizations/api/organizationDirectory.server";
import type { PaginatedOrganizationsResponse } from "@/features/organizations/api/organizations.api";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";

async function loadInitialDirectory(
  school: string,
): Promise<PaginatedOrganizationsResponse | null> {
  try {
    return await getOrganizationDirectorySnapshot(school);
  } catch (err) {
    console.error("Initial organization directory fetch failed:", err);
    return null;
  }
}

export default async function OrganizationsPage() {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const initialDirectory = await loadInitialDirectory(school);

  return (
    <OrganizationsRoute
      initialDirectory={initialDirectory}
      initialSchool={school}
    />
  );
}
