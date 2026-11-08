/** Global ephemeral modal, dropdown, and event-editing state. */

import { create } from "zustand";
import type { Event } from "@/shared/types";

interface UIState {
  showCommandPalette: boolean;
  showFilterDropdown: boolean;
  setShowCommandPalette: (show: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;

  editingEvent: Event | null;
  setEditingEvent: (event: Event | null) => void;
  clearEditingEvent: () => void;

  /** Settles the sign-in a page is waiting on: true once signed in, false if dismissed. */
  signInPrompt: ((signedIn: boolean) => void) | null;
  /** Asks the visitor to sign in over the page; resolves when the dialog closes. */
  promptSignIn: () => Promise<boolean>;
  settleSignInPrompt: (signedIn: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  showCommandPalette: false,
  showFilterDropdown: false,
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowFilterDropdown: (show) => set({ showFilterDropdown: show }),

  editingEvent: null,
  setEditingEvent: (event) => set({ editingEvent: event }),
  clearEditingEvent: () => set({ editingEvent: null }),

  signInPrompt: null,
  promptSignIn: () =>
    new Promise<boolean>((resolve) => {
      // One dialog at a time: a newer request answers the one it replaces.
      get().signInPrompt?.(false);
      set({ signInPrompt: resolve });
    }),
  settleSignInPrompt: (signedIn) => {
    const settle = get().signInPrompt;
    set({ signInPrompt: null });
    settle?.(signedIn);
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useUIStore.setState({
      showCommandPalette: false,
      showFilterDropdown: false,
      editingEvent: null,
    });
  });
}
