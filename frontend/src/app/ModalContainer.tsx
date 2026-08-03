/**
 * Owns global modal subscriptions and rendering so modal toggles do not
 * re-render route page content. Modal-only handlers (promote fallback,
 * submit close, onboarding open, clear filters) live here.
 */

import { useCallback, useEffect, useState } from "react";
import { useEventsStore } from "@/features/events/store/events.store";
import { useUIStore } from "@/shared/store/ui.store";
import { useFilterActions } from "@/features/search/hooks/useFilterState";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import type { EventFormData } from "@/shared/types";

type SubmitEventModalComponent =
  typeof import("@/features/events/components/SubmitEventModal").SubmitEventModal;
type CommandPaletteComponent =
  typeof import("@/shared/components/CommandPalette").CommandPalette;

export function ModalContainer() {
  const { profileCompleted } = useAuthState();

  const showCommandPalette = useUIStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const editingEvent = useUIStore((s) => s.editingEvent);
  const clearEditingEvent = useUIStore((s) => s.clearEditingEvent);
  const [SubmitEventModal, setSubmitEventModal] =
    useState<SubmitEventModalComponent | null>(null);
  const [CommandPalette, setCommandPalette] =
    useState<CommandPaletteComponent | null>(null);

  const updateEvent = useEventsStore((s) => s.updateEvent);

  const { clearAllFilters } = useFilterActions();

  useEffect(() => {
    if (!editingEvent || SubmitEventModal) return;
    let cancelled = false;
    void import("@/features/events/components/SubmitEventModal").then((module) => {
      if (!cancelled) setSubmitEventModal(() => module.SubmitEventModal);
    });
    return () => {
      cancelled = true;
    };
  }, [SubmitEventModal, editingEvent]);

  useEffect(() => {
    if (!showCommandPalette || CommandPalette) return;
    let cancelled = false;
    void import("@/shared/components/CommandPalette").then((module) => {
      if (!cancelled) setCommandPalette(() => module.CommandPalette);
    });
    return () => {
      cancelled = true;
    };
  }, [CommandPalette, showCommandPalette]);

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

  return (
    <>
      {editingEvent && SubmitEventModal ? (
        <SubmitEventModal
          isOpen
          onClose={handleSubmitEventClose}
          canCreateEvents
          editEventId={editingEvent.id}
          initialData={"title" in editingEvent ? eventToFormData(editingEvent) : undefined}
          loadEventForEdit={loadEventForEdit}
          onUpdate={async (eventId, eventData) => {
            await updateEvent(eventId, eventData);
            handleSubmitEventClose();
          }}
        />
      ) : null}

      {showCommandPalette && CommandPalette ? (
        <CommandPalette
          isOpen
          onOpenChange={setShowCommandPalette}
          setShowFilterDropdown={setShowFilterDropdown}
          onClearAllFilters={clearAllFilters}
          canSubmitEvents={profileCompleted}
        />
      ) : null}
    </>
  );
}
