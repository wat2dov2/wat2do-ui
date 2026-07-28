import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchProfileAPI } from "@/features/auth/api/auth.api";
import { OrganizationForm } from "@/features/organizations/components/AddOrganizationModal";
import { createOrganizationAPI } from "@/features/organizations/api/organizations.api";
import { useEventsStore } from "@/features/events/store/events.store";
import {
  organizationPagePath,
  ROUTES,
} from "@/shared/constants/routes";
import {
  getCurrentSchool,
  getSchoolDisplayName,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Organization } from "@/shared/types";

export function CreateOrganizationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(
    schoolFilter,
    getCurrentSchool(),
    loadUserProfile()?.school,
  );
  const schoolName = getSchoolDisplayName(school);

  const saveOrganization = async (
    organization: Organization,
  ): Promise<Organization> => {
    const created = await createOrganizationAPI({
      organization_name: organization.organization_name,
      categories: organization.categories,
      organization_page: organization.organization_page,
      ig: organization.ig,
      discord: organization.discord,
      organization_type: organization.organization_type,
      logo_url: organization.logo_url,
      school,
    });
    await Promise.all([
      fetchProfileAPI(),
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.all,
      }),
    ]);
    return created;
  };

  return (
    <Container size="md">
      <Stack gap={6}>
        <PageHeader
          back={{
            href: ROUTES.ORGANIZATIONS,
            label: t("organizations.allOrganizations"),
          }}
          title={t("organizations.submitOrganization")}
          description={t("organizations.addOrganizationDescription", {
            school: schoolName,
          })}
        />
        <Section variant="surface">
          <OrganizationForm
            onSave={saveOrganization}
            onSaved={(organization) => {
              if (organization.status === "pending") {
                toast({ description: t("organizations.submittedForReview") });
              }
              router.push(organizationPagePath(organization.id));
            }}
            defaultSchool={school}
            allowSchoolSelection={false}
            showHeading={false}
          />
        </Section>
      </Stack>
    </Container>
  );
}
