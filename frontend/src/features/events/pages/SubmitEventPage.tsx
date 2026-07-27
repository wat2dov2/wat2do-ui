import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/features/auth";
import { BuyCreditsModal } from "@/features/credits/components/BuyCreditsModal";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { useEventsStore } from "@/features/events/store/events.store";
import { submitEventForReview } from "@/shared/api/submissions.api";
import { ROUTES } from "@/shared/constants/routes";
import {
  getCurrentSchool,
  getSchoolDisplayName,
  resolveWritableSchool,
} from "@/shared/constants/schools";
import { loadUserProfile } from "@/features/auth/api/userRepository";
import { Container, PageHeader, Stack } from "@/shared/layout";
import type { EventFormData } from "@/shared/types";

export function SubmitEventPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAdmin, hasOrganization } = useAuthState();
  const canCreateEvents = hasOrganization || isAdmin;
  const addEvent = useEventsStore((state) => state.addEvent);
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveWritableSchool(
    schoolFilter,
    getCurrentSchool(),
    loadUserProfile()?.school,
  );
  const schoolName = getSchoolDisplayName(school);
  const userCredits = useCreditsStore((state) => state.userCredits);
  const addCredits = useCreditsStore((state) => state.addCredits);
  const promoteEvent = useCreditsStore((state) => state.promoteEvent);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const close = useCallback(() => {
    router.push(ROUTES.HOME);
  }, [router]);

  const submit = useCallback(
    async (eventData: EventFormData) => {
      if (eventData.organization_id == null) {
        throw new Error(t("events.organizationRequired"));
      }
      if (canCreateEvents) {
        const eventId = await addEvent(eventData);
        return { type: "event" as const, eventId };
      }
      await submitEventForReview(eventData);
      return { type: "submission" as const };
    },
    [addEvent, canCreateEvents, t],
  );

  const promote = useCallback(
    async (eventId: number): Promise<boolean> => {
      const result = await promoteEvent(eventId);
      if (result.needsCredits) {
        setShowBuyCredits(true);
        return false;
      }
      return result.success;
    },
    [promoteEvent, setShowBuyCredits],
  );

  return (
    <>
      <Container size="lg" className="py-4 sm:py-6">
        <Stack gap={6}>
          <PageHeader
            back={{ href: ROUTES.HOME, label: t("events.allEvents") }}
            title={t("events.createEvent")}
            description={t("events.submitEventSchoolDescription", {
              school: schoolName,
            })}
          />
          <SubmitEventFlow
            onClose={close}
            onSubmit={submit}
            canCreateEvents={canCreateEvents}
            userCredits={userCredits}
            onPromote={canCreateEvents ? promote : undefined}
            onBuyCredits={() => setShowBuyCredits(true)}
            showHeading={false}
          />
        </Stack>
      </Container>
      <BuyCreditsModal
        isOpen={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={userCredits}
        onPurchase={addCredits}
      />
    </>
  );
}
