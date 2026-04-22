/**
 * Posters Page Hook
 * Manages local state for a posters page to reduce component complexity.
 * Shared by admin and club-panel posters pages.
 */

import { useState } from "react";

export function usePostersPage() {
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
