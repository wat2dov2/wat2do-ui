/**
 * Admin Scroll To Item Hook
 * Handles scrolling to items based on URL params
 */

import { useEffect } from "react";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";

export function useAdminScrollToItem(itemId: string | null, delay = SCROLL_INTO_VIEW_DELAY_MS) {
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
