/**
 * Admin Refresh Hook
 * Manages refresh state for admin pages
 */

import { useState, useCallback } from "react";

export function useAdminRefresh() {
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return { refreshKey, refresh };
}
