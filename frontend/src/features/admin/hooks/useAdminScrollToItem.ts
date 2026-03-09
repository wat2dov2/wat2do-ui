/**
 * Admin Scroll To Item Hook
 * Handles scrolling to items based on URL params
 */

import { useEffect } from "react";

export function useAdminScrollToItem(itemId: string | null, delay = 100) {
  useEffect(() => {
    if (itemId) {
      setTimeout(() => {
        const element = document.getElementById(itemId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, delay);
    }
  }, [itemId, delay]);
}
