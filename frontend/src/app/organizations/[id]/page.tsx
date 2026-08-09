import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { AppPage } from "@/app/app-page";
import imgContactHero from "@/assets/contact_hero.png";
import { getOrganizationEventsSnapshot } from "@/features/events/api/eventFeed.server";
import { getOrganizationPositionsSnapshot } from "@/features/positions/api/positionDirectory.server";
import { getOrganizationDetailSnapshot } from "@/features/organizations/api/organizationDirectory.server";
import { isOrganizationIndexable } from "@/features/organizations/lib/organizationSeo";
import { OrganizationDetailsPage as OrganizationDetailsPageContent } from "@/features/organizations/pages/OrganizationDetailsPage";
import { getSchool } from "@/shared/api/schools.server";
import { organizationPagePath } from "@/shared/constants/routes";
import {
  buildNoIndexPageMetadata,
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  isCanonicalProductionHost,
  selectSeoImage,
} from "@/shared/lib/seo";
import type { Organization } from "@/shared/types";

interface OrganizationDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function parseOrganizationId(value: string): number | null {
  const organizationId = Number(value);
  return Number.isInteger(organizationId) && organizationId > 0
    ? organizationId
    : null;
}

async function loadOrganization(
  organizationId: number,
): Promise<Organization | null> {
  try {
    return await getOrganizationDetailSnapshot(organizationId);
  } catch (error) {
    console.error("Organization SEO detail fetch failed:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: OrganizationDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const organizationId = parseOrganizationId(id);
  const organization = organizationId
    ? await loadOrganization(organizationId)
    : null;
  const fallbackImage = {
    url: imgContactHero.src,
    alt: "Discover student organizations with Wat2Do",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  };

  if (!organization || organization.status !== "approved") {
    return buildNoIndexPageMetadata({
      title: "Organization Not Found | Wat2Do",
      description: "This Wat2Do organization could not be found.",
      image: fallbackImage,
    });
  }

  const schoolRecord = await getSchool(organization.school);
  const schoolName = schoolRecord?.name ?? organization.school;
  const title = `${organization.organization_name} Events and Positions at ${schoolName} | Wat2Do`;
  const categoryText = organization.categories.join(", ");
  const description = `Explore ${organization.organization_name} at ${schoolName}${categoryText ? `, a student organization focused on ${categoryText}` : ""}. Find upcoming events, open positions, and verified ways to connect.`;

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(
      organization.school,
      organizationPagePath(organization.id),
    ),
    image: selectSeoImage(
      organization.logo_url,
      `${organization.organization_name} logo`,
      fallbackImage,
    ),
    index: isOrganizationIndexable(organization),
  });
}

export default async function OrganizationDetailsPage({
  params,
}: OrganizationDetailsPageProps) {
  const { id } = await params;
  const organizationId = parseOrganizationId(id);
  if (!organizationId) notFound();

  const organization = await getOrganizationDetailSnapshot(organizationId);
  if (!organization || organization.status !== "approved") notFound();

  const canonicalUrl = getSchoolCanonicalUrl(
    organization.school,
    organizationPagePath(organization.id),
  );
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isCanonicalProductionHost(requestHost, canonicalUrl)) {
    permanentRedirect(canonicalUrl);
  }

  const [schoolRecord, initialEvents, initialPositions] = await Promise.all([
    getSchool(organization.school),
    getOrganizationEventsSnapshot(organization.id, organization.school),
    getOrganizationPositionsSnapshot(organization.id, organization.school),
  ]);
  return (
    <AppPage>
      <OrganizationDetailsPageContent
        organizationId={organization.id}
        initialOrganization={organization}
        initialEvents={initialEvents}
        initialPositions={initialPositions}
        schoolName={schoolRecord?.name ?? organization.school}
      />
    </AppPage>
  );
}
