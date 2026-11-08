import { useCallback } from "react";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { getUserProfile, useAuthState } from "@/features/auth";
import { useOwnClub } from "@/features/clubs";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { useEventsStore } from "@/features/events/store/events.store";
import { createEventAPI, submitEventForReview } from "@/features/events/api/events.api";
import { ROUTES } from "@/shared/constants/routes";
import {
  getCurrentSchool,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { Container, Stack } from "@/shared/layout";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { EventFormData } from "@/shared/types";

export function SubmitEventPage() {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const router = useRouter();
  const { isAdmin, hasClub } = useAuthState();
  const canCreateEvents = hasClub || isAdmin;
  // A club owner's events are always their own club's, so no list of clubs is offered.
  const ownClub = useOwnClub();
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(
    schoolFilter,
    getCurrentSchool(),
    loadUserProfile()?.school,
  );

  const close = useCallback(() => {
    router.push(ROUTES.EVENTS);
  }, [router]);

  const submit = useCallback(
    async (eventData: EventFormData) => {
      if (eventData.club_id == null) {
        throw new Error(t("events.clubRequired"));
      }
      // Read when it is sent: a visitor may have signed in only to send it.
      const profile = getUserProfile();
      const managesClub =
        profile?.role === "admin" ||
        Boolean(profile?.clubs.some((club) => club.id === eventData.club_id));
      if (managesClub) {
        const event = await createEventAPI(eventData);
        return { type: "event" as const, eventId: event.id };
      }
      await submitEventForReview(eventData);
      return { type: "submission" as const };
    },
    [t],
  );

  return (
    <Container size="lg">
      <Stack gap={6}>
        <PageShellHeader
          route={ROUTES.EVENT_SUBMIT}
          description={ownClub ? undefined : t("events.submitEventSchoolDescription", {
            school: getSchoolName(school),
          })}
        />
        <SubmitEventFlow
          onClose={close}
          onSubmit={submit}
          canCreateEvents={canCreateEvents}
          showHeading={false}
        />
      </Stack>
    </Container>
  );
}
