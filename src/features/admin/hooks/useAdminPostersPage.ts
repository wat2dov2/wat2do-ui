/**
 * Admin Posters Page Hook
 * Manages local state for AdminPostersPage to reduce component complexity
 */

import { useState } from "react";

export function useAdminPostersPage() {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  return {
    deleteConfirmId,
    setDeleteConfirmId,
    refreshKey,
    setRefreshKey,
    showCreateModal,
    setShowCreateModal,
  };
}
