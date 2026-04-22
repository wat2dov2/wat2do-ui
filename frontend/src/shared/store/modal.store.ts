/**
 * Modal Store (Zustand)
 *
 * Tracks whether global app-level modals and dropdowns are open:
 *   - showSubmitEvent   — Create/Edit event modal
 *   - showCommandPalette — Cmd+K command palette
 *   - showFilterDropdown — More-filters dropdown on the events page
 *     (lives here so the command palette can open it remotely without
 *     coupling to the search filter store).
 *
 * Replaces the old ModalContext. Subscribers read via selectors so
 * unrelated consumers don't re-render when one modal toggles.
 * The dead `showOnboarding` slot from the old context was removed —
 * onboarding is a full-page route, not a modal.
 */

import { create } from "zustand";

interface ModalState {
  showSubmitEvent: boolean;
  showCommandPalette: boolean;
  showFilterDropdown: boolean;
  setShowSubmitEvent: (show: boolean) => void;
  setShowCommandPalette: (show: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  showSubmitEvent: false,
  showCommandPalette: false,
  showFilterDropdown: false,
  setShowSubmitEvent: (show) => set({ showSubmitEvent: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowFilterDropdown: (show) => set({ showFilterDropdown: show }),
}));
