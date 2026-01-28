/**
 * Admin Delete Confirm Hook
 * Manages delete confirmation state
 */

import { useState, useCallback } from "react";

export function useAdminDeleteConfirm<T extends string | number = string>() {
  const [deleteConfirmId, setDeleteConfirmId] = useState<T | null>(null);

  const requestDelete = useCallback((id: T) => {
    setDeleteConfirmId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  const confirmDelete = useCallback((onConfirm: (id: T) => void) => {
    if (deleteConfirmId !== null) {
      onConfirm(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId]);

  return {
    deleteConfirmId,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
