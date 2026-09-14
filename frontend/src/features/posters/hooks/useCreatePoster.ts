import { useCallback } from "react";
import { createPosterToBackend } from "@/features/posters/api/posters.api";
import { getSessionEmail } from "@/features/auth";

/** Resolve the session email and expose the shared poster creation request. */
export function useCreatePoster() {
  const resolveEmail = useCallback((contextEmail?: string | null): string => {
    return contextEmail ?? getSessionEmail() ?? "";
  }, []);

  return { resolveEmail, createPoster: createPosterToBackend };
}
