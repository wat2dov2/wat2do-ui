import { useCallback } from "react";
import { createPosterToBackend } from "@/features/qrcode/api/qrcode.api";
import { getSession } from "@/features/auth";
import type { QRCode } from "@/shared/types";

export interface CreatePosterPayload {
  id: string;
  name: string;
  description?: string | null;
  destination_type: string;
  destination_id?: string | number | null;
  filters?: Record<string, unknown> | unknown[] | null;
  created_by: string;
  is_active?: boolean;
  image_url?: string | null;
}

export interface UseCreatePosterReturn {
  /** Resolved email for the current session (contextEmail takes precedence over session). */
  resolveEmail: (contextEmail?: string | null) => string;
  /** Create a poster via the backend API. */
  createPoster: (payload: CreatePosterPayload) => Promise<QRCode>;
}

/**
 * Wraps poster creation API call and session-based email resolution.
 * Components should call this hook instead of importing createPosterToBackend
 * or getSession() directly.
 */
export function useCreatePoster(): UseCreatePosterReturn {
  const resolveEmail = useCallback((contextEmail?: string | null): string => {
    return contextEmail ?? getSession().email ?? "";
  }, []);

  const createPoster = useCallback(
    (payload: CreatePosterPayload): Promise<QRCode> => {
      return createPosterToBackend(payload);
    },
    []
  );

  return { resolveEmail, createPoster };
}
