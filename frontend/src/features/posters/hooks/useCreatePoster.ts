import { useCallback } from "react";
import {
  createPosterToBackend,
  type CreatePosterPayload,
} from "@/features/posters/api/posters.api";
import { getSessionEmail } from "@/features/auth";
import type { QRCode } from "@/features/posters/types";

export interface UseCreatePosterReturn {
  /** Resolved email for the current session (contextEmail takes precedence over session). */
  resolveEmail: (contextEmail?: string | null) => string;
  /** Create a poster via the backend API. */
  createPoster: (payload: CreatePosterPayload) => Promise<QRCode>;
}

/**
 * Wraps poster creation API call and session-based email resolution.
 * Components should call this hook instead of importing createPosterToBackend
 * or getSessionEmail() directly.
 */
export function useCreatePoster(): UseCreatePosterReturn {
  const resolveEmail = useCallback((contextEmail?: string | null): string => {
    return contextEmail ?? getSessionEmail() ?? "";
  }, []);

  const createPoster = useCallback(
    (payload: CreatePosterPayload): Promise<QRCode> => {
      return createPosterToBackend(payload);
    },
    []
  );

  return { resolveEmail, createPoster };
}
