import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppPage } from "@/app/app-page";
import imgContactHero from "@/assets/contact_hero.png";
import { getOrganizationDirectorySnapshot } from "@/features/organizations/api/organizationDirectory.server";
import type { PaginatedOrganizationsResponse } from "@/features/organizations/api/organizations.api";
import { OrganizationsPage as OrganizationsPageContent } from "@/features/organizations/pages/OrganizationsPage";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import {
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  selectSeoImage,
} from "@/shared/lib/seo";

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

async function resolveRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const school = await resolveRequestSchool();
  const [schoolRecord, directory] = await Promise.all([
    getSchool(school),
    loadInitialDirectory(school),
  ]);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${schoolName} Clubs and Student Organizations | Wat2Do`;
  const description = `Explore clubs and student organizations at ${schoolName}. Find communities, upcoming events, social links, and ways to get involved.`;
  const featuredOrganization = directory?.items.find(
    (organization) => organization.logo_url,
  );

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, "/organizations"),
    image: selectSeoImage(
      featuredOrganization?.logo_url,
      featuredOrganization
        ? `${featuredOrganization.organization_name} logo`
        : "",
      {
        url: imgContactHero.src,
        alt: `Discover clubs and student organizations at ${schoolName}`,
        width: imgContactHero.width,
        height: imgContactHero.height,
        type: "image/png",
      },
    ),
    index: Boolean(directory && directory.total > 0),
  });
}

export default async function OrganizationsPage() {
  const school = await resolveRequestSchool();
  const initialDirectory = await loadInitialDirectory(school);

  return (
    <AppPage renderBeforeReady>
      <OrganizationsPageContent
        initialDirectory={initialDirectory}
        initialSchool={school}
      />
    </AppPage>
  );
}
