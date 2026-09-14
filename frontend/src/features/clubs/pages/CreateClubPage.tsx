import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchProfileAPI } from "@/features/auth/api/auth.api";
import { ClubForm } from "@/features/clubs/components/AddClubModal";
import { createClubAPI } from "@/features/clubs/api/clubs.api";
import { useEventsStore } from "@/features/events/store/events.store";
import {
  clubPagePath,
  ROUTES,
} from "@/shared/constants/routes";
import {
  getCurrentSchool,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Club } from "@/shared/types";

export function CreateClubPage() {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const router = useRouter();
  const queryClient = useQueryClient();
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(
    schoolFilter,
    getCurrentSchool(),
    loadUserProfile()?.school,
  );
  const saveClub = async (
    club: Club,
  ): Promise<Club> => {
    const created = await createClubAPI({
      club_name: club.club_name,
      categories: club.categories,
      club_page: club.club_page,
      ig: club.ig,
      discord: club.discord,
      club_type: club.club_type,
      logo_url: club.logo_url,
      school,
    });
    await Promise.all([
      fetchProfileAPI(),
      queryClient.invalidateQueries({
        queryKey: queryKeys.clubs.all,
      }),
    ]);
    return created;
  };

  return (
    <Container size="md">
      <Stack gap={6}>
        <PageHeader
          back={{
            href: ROUTES.CLUBS,
            label: t("clubs.allClubs"),
          }}
          title={t("clubs.submitClub")}
          description={t("clubs.addClubDescription", {
            school: getSchoolName(school),
          })}
        />
        <Section variant="surface">
          <ClubForm
            onSave={saveClub}
            onSaved={(club) => {
              if (club.status === "pending") {
                toast({ description: t("clubs.submittedForReview") });
              }
              router.push(clubPagePath(club.id));
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
