/**
 * ModalContainer
 *
 * Owns the global modal subscriptions and rendering. Isolating the
 * modal-store subscriptions here prevents modal toggles from
 * re-rendering the Routes subtree in AppContent.
 *
 * Subscribes to:
 *   - showSubmitChoice / setShowSubmitChoice
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
import { Building2, Calendar, Heart, LogIn } from "@/shared/ui/doodle-icons";
import { useEventsStore } from "@/features/events/store/events.store";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { CommandItem } from "@/shared/ui/command";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useUIStore } from "@/shared/store/ui.store";
import { useSearchStore } from "@/features/search/store/search.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { submitEventForReview } from "@/shared/api/submissions.api";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import { ROUTES } from "@/shared/constants/routes";
import type { EventFormData, Organization } from "@/shared/types";
import { createOrganizationAPI } from "@/features/organizations";

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

const AddOrganizationModal = lazy(() =>
  import("@/features/organizations").then((m) => ({
    default: m.AddOrganizationModal,
  }))
);

export function ModalContainer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profileCompleted, isAdmin, hasOrganization } = useAuthState();
  const canCreateEvents = hasOrganization || isAdmin;

  // ── UI-store subscriptions (isolated from AppContent) ─────
  const showSubmitChoice = useUIStore((s) => s.showSubmitChoice);
  const setShowSubmitChoice = useUIStore((s) => s.setShowSubmitChoice);
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
  const [showAddOrganization, setShowAddOrganization] = useState(false);

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

  const handleChooseSubmitEvent = useCallback(() => {
    setShowSubmitChoice(false);
    setShowSubmitEvent(true);
  }, [setShowSubmitChoice, setShowSubmitEvent]);

  const handleChooseSubmitOrganization = useCallback(() => {
    setShowSubmitChoice(false);
    setShowAddOrganization(true);
  }, [setShowSubmitChoice]);

  const handleSubmitOrganization = useCallback(async (organization: Organization) => {
    await createOrganizationAPI({
      organization_name: organization.organization_name,
      categories: organization.categories,
      organization_page: organization.organization_page,
      ig: organization.ig,
      discord: organization.discord,
      organization_type: organization.organization_type,
      logo_url: organization.logo_url,
      created_by: organization.created_by,
      school: organization.school,
    });
  }, []);

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
      <Dialog open={showSubmitChoice} onOpenChange={setShowSubmitChoice}>
        <DialogContent className="max-w-md" aria-describedby="submit-choice-description">
          <DialogHeader>
            <DialogTitle>{t("submitChoice.title")}</DialogTitle>
            <DialogDescription id="submit-choice-description">
              {t("submitChoice.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-3 p-4 text-left"
              onMouseDown={handleChooseSubmitEvent}
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Calendar className="size-5" />
              </span>
              <span className="space-y-1">
                <span className="block font-medium text-foreground">{t("submitChoice.eventTitle")}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {t("submitChoice.eventDescription")}
                </span>
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-3 p-4 text-left"
              onMouseDown={handleChooseSubmitOrganization}
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </span>
              <span className="space-y-1">
                <span className="block font-medium text-foreground">{t("submitChoice.organizationTitle")}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {t("submitChoice.organizationDescription")}
                </span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
            await updateEvent(eventId, eventData);
            handleSubmitEventClose();
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AddOrganizationModal
          isOpen={showAddOrganization}
          onClose={() => setShowAddOrganization(false)}
          onSave={handleSubmitOrganization}
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
        canSubmitEvents
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
