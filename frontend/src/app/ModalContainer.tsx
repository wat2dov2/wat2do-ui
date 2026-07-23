/**
 * Owns global modal subscriptions and rendering so modal toggles do not
 * re-render route page content. Modal-only handlers (promote fallback,
 * submit close, onboarding open, clear filters) live here.
 */

import { useCallback, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Heart, LogIn } from "@/shared/ui/doodle-icons";
import { useEventsStore } from "@/features/events/store/events.store";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { CommandItem } from "@/shared/ui/command";
import { useUIStore } from "@/shared/store/ui.store";
import { useFilterActions } from "@/features/search";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { ROUTES } from "@/shared/constants/routes";
import type { EventFormData } from "@/shared/types";

const SubmitEventModal = lazy(() =>
  import("@/features/events/components/SubmitEventModal").then((m) => ({
    default: m.SubmitEventModal,
  }))
);

export function ModalContainer() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profileCompleted } = useAuthState();

  const showCommandPalette = useUIStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const editingEvent = useUIStore((s) => s.editingEvent);
  const clearEditingEvent = useUIStore((s) => s.clearEditingEvent);

  const updateEvent = useEventsStore((s) => s.updateEvent);

  const { clearAllFilters } = useFilterActions();

  const handleSubmitEventClose = useCallback(() => {
    clearEditingEvent();
  }, [clearEditingEvent]);

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

  return (
    <>
      <Suspense fallback={null}>
        <SubmitEventModal
          isOpen={editingEvent !== null}
          onClose={handleSubmitEventClose}
          canCreateEvents
          editEventId={editingEvent?.id}
          initialData={editingEvent && "title" in editingEvent ? eventToFormData(editingEvent) : undefined}
          loadEventForEdit={loadEventForEdit}
          onUpdate={async (eventId, eventData) => {
            await updateEvent(eventId, eventData);
            handleSubmitEventClose();
          }}
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
              <span>{t("commands.goingEvents")}</span>
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
