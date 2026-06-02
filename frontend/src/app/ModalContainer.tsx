/**
 * ModalContainer
 *
 * Owns the global modal subscriptions and rendering. Isolating the
 * modal-store subscriptions here prevents modal toggles from
 * re-rendering the Routes subtree in AppContent.
 *
 * Subscribes to:
 *   - showSubmitEvent / setShowSubmitEvent
 *   - showCommandPalette / setShowCommandPalette
 *   - setShowFilterDropdown (passed to CommandPalette)
 *
 * Owns local state:
 *   - showBuyCredits (only consumed by BuyCreditsModal + SubmitEventModal)
 *
 * Modal-only handlers (promote-with-credit-fallback, submit-close,
 * open-onboarding, clear-filters) live here because nothing outside
 * the modals needs them.
 */

import { useCallback, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Heart, LogIn } from "lucide-react";
import { useEventsStore } from "@/features/events/store/events.store";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { CommandItem } from "@/shared/ui/command";
import { useUIStore } from "@/shared/store/ui.store";
import { useSearchStore } from "@/features/search/store/search.store";
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
  const navigate = useNavigate();
  const { profileCompleted, isAdmin, hasClub, clubId } = useAuthState();
  const canCreateEvents = hasClub || isAdmin;
  const canSubmitEvents = profileCompleted;

  // ── UI-store subscriptions (isolated from AppContent) ─────
  const showSubmitEvent = useUIStore((s) => s.showSubmitEvent);
  const setShowSubmitEvent = useUIStore((s) => s.setShowSubmitEvent);
  const showCommandPalette = useUIStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const editingEvent = useUIStore((s) => s.editingEvent);
  const clearEditingEvent = useUIStore((s) => s.clearEditingEvent);

  // ── Events store actions ─────────────────────────────────────
  const addEvent = useEventsStore((s) => s.addEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);

  // ── Credits / promotions ─────────────────────────────────────
  const userCredits = useCreditsStore((s) => s.userCredits);
  const storeAddCredits = useCreditsStore((s) => s.addCredits);
  const storePromoteEvent = useCreditsStore((s) => s.promoteEvent);

  // ── Search store setter (stable ref) ─────────────────────────
  const clearAllFilters = useSearchStore((s) => s.clearAllFilters);

  // ── Buy credits modal (local UI state) ───────────────────────
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
    navigate(ROUTES.ONBOARDING);
  }, [navigate]);

  const handleSubmitEvent = useCallback(
    async (eventData: EventFormData) => {
      const resolvedClubId = eventData.club_id ?? clubId;
      if (resolvedClubId == null) {
        throw new Error("Missing active club ID for event submission");
      }
      const payload = {
        ...eventData,
        club_id: resolvedClubId,
      };
      if (canCreateEvents) {
        const eventId = await addEvent(payload);
        return { type: "event" as const, eventId };
      }
      await submitEventForReview(payload);
      return { type: "submission" as const };
    },
    [addEvent, canCreateEvents, clubId],
  );

  return (
    <>
      <Suspense fallback={null}>
        <SubmitEventModal
          isOpen={showSubmitEvent}
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
            const resolvedClubId = eventData.club_id ?? clubId;
            const payload = {
              ...eventData,
              club_id: resolvedClubId ?? undefined,
            };
            await updateEvent(eventId, payload);
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
        canSubmitEvents={canSubmitEvents}
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
