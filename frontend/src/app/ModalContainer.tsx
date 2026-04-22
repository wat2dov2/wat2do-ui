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

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Heart, LogIn } from "lucide-react";
import { SubmitEventModal } from "@/features/events";
import { CommandPalette } from "@/features/commands/components/CommandPalette";
import { BuyCreditsModal } from "@/features/credits/components/BuyCreditsModal";
import { CommandItem } from "@/shared/ui/command";
import { useModalStore } from "@/shared/store/modal.store";
import { useSearchStore } from "@/features/search/store/search.store";
import { useEventsStore } from "@/features/events/store/events.store";
import { useCreditsStore, usePromotionsStore } from "@/features/credits";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { ROUTES } from "@/shared/constants/routes";
import type { Event, EventFormData } from "@/shared/types";

interface ModalContainerProps {
  /** The event currently being edited (null when creating). Owned by AppContent because admin/club configs also need handleEditEventAndOpenModal. */
  editingEvent: Event | null;
  /** Clear the editing-event state in the parent when the modal closes. */
  clearEditing: () => void;
}

export function ModalContainer({ editingEvent, clearEditing }: ModalContainerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profileCompleted = useProfileCompleted();

  // ── Modal-store subscriptions (isolated from AppContent) ─────
  const showSubmitEvent = useModalStore((s) => s.showSubmitEvent);
  const setShowSubmitEvent = useModalStore((s) => s.setShowSubmitEvent);
  const showCommandPalette = useModalStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useModalStore((s) => s.setShowCommandPalette);
  const setShowFilterDropdown = useModalStore((s) => s.setShowFilterDropdown);

  // ── Events store actions ─────────────────────────────────────
  const addEvent = useEventsStore((s) => s.addEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);

  // ── Credits / promotions ─────────────────────────────────────
  const userCredits = useCreditsStore((s) => s.userCredits);
  const storeAddCredits = useCreditsStore((s) => s.addCredits);
  const storePromoteEvent = usePromotionsStore((s) => s.promoteEvent);

  // ── Search store setter (stable ref) ─────────────────────────
  const clearAllFilters = useSearchStore((s) => s.clearAllFilters);

  // ── Buy credits modal (local UI state) ───────────────────────
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const promoteEvent = useCallback(
    async (eventId: number, packageId: string): Promise<boolean> => {
      const result = await storePromoteEvent(eventId, packageId);
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
    clearEditing();
  }, [setShowSubmitEvent, clearEditing]);

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

  return (
    <>
      <SubmitEventModal
        isOpen={showSubmitEvent}
        onClose={handleSubmitEventClose}
        onSubmit={async (eventData) => addEvent(eventData)}
        userCredits={userCredits}
        onPromote={promoteEvent}
        onBuyCredits={() => setShowBuyCredits(true)}
        editEventId={editingEvent?.id}
        initialData={editingEvent && "title" in editingEvent ? eventToFormData(editingEvent) : undefined}
        loadEventForEdit={loadEventForEdit}
        onUpdate={async (eventId, eventData) => {
          await updateEvent(eventId, eventData);
          handleSubmitEventClose();
        }}
      />

      <BuyCreditsModal
        isOpen={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={userCredits}
        onPurchase={storeAddCredits}
      />

      <CommandPalette
        isOpen={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        setShowFilterDropdown={setShowFilterDropdown}
        onClearAllFilters={clearAllFilters}
        personalItems={
          profileCompleted ? (
            <CommandItem
              onSelect={() => {
                setShowCommandPalette(false);
              }}
            >
              <Heart className="mr-2 h-4 w-4" />
              <span>{t("commands.savedEvents")}</span>
            </CommandItem>
          ) : (
            <CommandItem
              onSelect={() => {
                handleOpenOnboardingRoute();
                setShowCommandPalette(false);
              }}
            >
              <LogIn className="mr-2 h-4 w-4" />
              <span>{t("commands.signInToUnlockFeatures")}</span>
            </CommandItem>
          )
        }
        profileLabel={profileCompleted ? t("commands.editProfile") : t("commands.createProfile")}
      />
    </>
  );
}
