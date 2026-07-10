/**
 * Owns global modal subscriptions and rendering so modal toggles do not
 * re-render route page content. Modal-only handlers (promote fallback,
 * submit close, onboarding open, clear filters) live here.
 */

import { useCallback, useState, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Heart, LogIn } from "@/shared/ui/doodle-icons";
import { useEventsStore } from "@/features/events/store/events.store";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { CommandItem } from "@/shared/ui/command";
import { useUIStore } from "@/shared/store/ui.store";
import { useFilterActions } from "@/features/search";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { submitEventForReview } from "@/shared/api/submissions.api";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { ROUTES } from "@/shared/constants/routes";
import type { EventFormData } from "@/shared/types";

const SubmitEventModal = lazy(() =>
  import("@/features/events/components/SubmitEventModal").then((m) => ({
    default: m.SubmitEventModal,
  }))
);

const BuyCreditsModal = lazy(() =>
  import("@/features/credits/components/BuyCreditsModal").then((m) => ({
    default: m.BuyCreditsModal,
  }))
);

export function ModalContainer() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profileCompleted, isAdmin, hasOrganization } = useAuthState();
  const canCreateEvents = hasOrganization || isAdmin;

  const showSubmitEvent = useUIStore((s) => s.showSubmitEvent);
  const setShowSubmitEvent = useUIStore((s) => s.setShowSubmitEvent);
  const showCommandPalette = useUIStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const editingEvent = useUIStore((s) => s.editingEvent);
  const clearEditingEvent = useUIStore((s) => s.clearEditingEvent);

  const addEvent = useEventsStore((s) => s.addEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);

  const userCredits = useCreditsStore((s) => s.userCredits);
  const storeAddCredits = useCreditsStore((s) => s.addCredits);
  const storePromoteEvent = useCreditsStore((s) => s.promoteEvent);

  const { clearAllFilters } = useFilterActions();

  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const promoteEvent = useCallback(
    async (eventId: number): Promise<boolean> => {
      const result = await storePromoteEvent(eventId);
      if (result.needsCredits) {
        setShowBuyCredits(true);
        return false;
      }
      return result.success;
    },
    [storePromoteEvent],
  );

  const handleSubmitEventClose = useCallback(() => {
    setShowSubmitEvent(false);
    clearEditingEvent();
  }, [setShowSubmitEvent, clearEditingEvent]);

  const loadEventForEdit = useCallback(
    async (eventId: number): Promise<EventFormData> => {
      const { fetchEventById } = await import("@/features/events/api/events.api");
      const fullEvent = await fetchEventById(eventId);
      fullEvent.category = getEventCategory(fullEvent);
      return eventToFormData(fullEvent);
    },
    [],
  );

  const handleOpenOnboardingRoute = useCallback(() => {
    router.push(ROUTES.ONBOARDING);
  }, [router]);

  const handleSubmitEvent = useCallback(
    async (eventData: EventFormData) => {
      if (eventData.organization_id == null) {
        throw new Error("A club must be selected for event submission");
      }
      if (canCreateEvents) {
        const eventId = await addEvent(eventData);
        return { type: "event" as const, eventId };
      }
      await submitEventForReview(eventData);
      return { type: "submission" as const };
    },
    [addEvent, canCreateEvents],
  );

  return (
    <>
      <Suspense fallback={null}>
        <SubmitEventModal
          isOpen={showSubmitEvent && profileCompleted}
          onClose={handleSubmitEventClose}
          onSubmit={handleSubmitEvent}
          canCreateEvents={canCreateEvents}
          userCredits={userCredits}
          onPromote={profileCompleted && canCreateEvents ? promoteEvent : undefined}
          onBuyCredits={() => setShowBuyCredits(true)}
          editEventId={editingEvent?.id}
          initialData={editingEvent && "title" in editingEvent ? eventToFormData(editingEvent) : undefined}
          loadEventForEdit={loadEventForEdit}
          onUpdate={async (eventId, eventData) => {
            await updateEvent(eventId, eventData);
            handleSubmitEventClose();
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <BuyCreditsModal
          isOpen={showBuyCredits}
          onClose={() => setShowBuyCredits(false)}
          currentCredits={userCredits}
          onPurchase={storeAddCredits}
        />
      </Suspense>

      <CommandPalette
        isOpen={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        setShowFilterDropdown={setShowFilterDropdown}
        onClearAllFilters={clearAllFilters}
        canSubmitEvents={profileCompleted}
        personalItems={
          profileCompleted ? (
            <CommandItem
              onSelect={() => {
                setShowCommandPalette(false);
              }}
            >
              <Heart className="mr-2 size-4" />
              <span>{t("commands.savedEvents")}</span>
            </CommandItem>
          ) : (
            <CommandItem
              onSelect={() => {
                handleOpenOnboardingRoute();
                setShowCommandPalette(false);
              }}
            >
              <LogIn className="mr-2 size-4" />
              <span>{t("commands.signInToUnlockFeatures")}</span>
            </CommandItem>
          )
        }
        profileLabel={profileCompleted ? t("commands.editProfile") : t("commands.createProfile")}
      />
    </>
  );
}
