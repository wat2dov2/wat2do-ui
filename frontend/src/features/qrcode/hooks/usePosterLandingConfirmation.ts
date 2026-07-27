import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import {
  clearPosterScanConfirmation,
  confirmPosterLanding,
  loadPosterScanConfirmation,
} from "@/features/qrcode/api/qrcode.api";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { QP } from "@/shared/constants/queryParams";
import { isApiError } from "@/shared/services/apiClient";

const CONFIRMATION_ROUNDING_BUFFER_MS = 1_000;

export function usePosterLandingConfirmation(): void {
  const searchParams = useSearchParams();
  const confirmationInFlightRef = useRef(false);
  const posterId = searchParams.get(QP.POSTER_ID);
  const isPosterLanding = searchParams.get(QP.UTM_SOURCE) === "poster";

  useEffect(() => {
    if (!isPosterLanding || !posterId) {
      return;
    }

    const staged = loadPosterScanConfirmation();
    if (!staged || staged.posterId !== posterId) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || confirmationInFlightRef.current) {
        return;
      }

      confirmationInFlightRef.current = true;
      confirmPosterLanding(staged.token)
        .then(() => {
          clearPosterScanConfirmation(staged.token);
        })
        .catch((error) => {
          if (isApiError(error) && [400, 404, 409, 410].includes(error.status)) {
            clearPosterScanConfirmation(staged.token);
            return;
          }
          console.error("Failed to confirm poster landing:", error);
        })
        .finally(() => {
          confirmationInFlightRef.current = false;
        });
    }, promoterProgram.landingConfirmationSeconds * 1_000 + CONFIRMATION_ROUNDING_BUFFER_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isPosterLanding, posterId]);
}
