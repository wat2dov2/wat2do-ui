import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { useEventsStore } from "@/features/events/store/events.store";
import { createEventAPI } from "@/features/events/api/events.api";
import { submitEventForReview } from "@/shared/api/submissions.api";
import { ROUTES } from "@/shared/constants/routes";
import {
  getCurrentSchool,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { EventFormData } from "@/shared/types";

export function SubmitEventPage() {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  const router = useRouter();
  const { isAdmin, hasClub } = useAuthState();
  const canCreateEvents = hasClub || isAdmin;
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(
    schoolFilter,
    getCurrentSchool(),
    loadUserProfile()?.school,
  );

  const close = useCallback(() => {
    router.push(ROUTES.HOME);
  }, [router]);

  const submit = useCallback(
    async (eventData: EventFormData) => {
      if (eventData.club_id == null) {
        throw new Error(t("events.clubRequired"));
      }
      if (canCreateEvents) {
        const event = await createEventAPI(eventData);
        return { type: "event" as const, eventId: event.id };
      }
      await submitEventForReview(eventData);
      return { type: "submission" as const };
    },
    [canCreateEvents, t],
  );

  return (
    <Container size="lg">
      <Stack gap={6}>
        <PageHeader
          back={{ href: ROUTES.HOME, label: t("events.allEvents") }}
          title={t("events.createEvent")}
          description={t("events.submitEventSchoolDescription", {
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
