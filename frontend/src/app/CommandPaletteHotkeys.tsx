/**
 * CommandPaletteHotkeys
 *
 * Registers the global Cmd+K / Ctrl+K keyboard shortcut that toggles
 * the command palette. Kept as a tiny sibling component (rather than
 * inside a context provider) so toggling the palette does not
 * re-render any unrelated subtree.
 */

import { useEffect } from "react";
import { useModalStore } from "@/shared/store/modal.store";

export function CommandPaletteHotkeys() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const { showCommandPalette, setShowCommandPalette } = useModalStore.getState();
        setShowCommandPalette(!showCommandPalette);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
