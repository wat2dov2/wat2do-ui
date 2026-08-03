import { useCallback, useState } from "react";

import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { STORAGE_KEYS } from "@/shared/constants/storageKeys";
import { StorageService } from "@/shared/services/storageService";

export interface PromoterState {
  userId: string | null;
  isAuthenticated: boolean;
  userEmail: string | null;
  school: string | null;
  payoutEmail: string | null;
  isEnrolled: boolean;
  isProgramEnabled: boolean;
}

export function usePromoterState(): PromoterState {
  const auth = useAuthState();
  const isEnrolled = Boolean(
    auth.payoutEmail &&
      auth.promoterTosAcceptedAt &&
      auth.promoterTosVersion,
  );

  return {
    userId: auth.userId,
    isAuthenticated: auth.isAuthenticated,
    userEmail: auth.userEmail,
    school: auth.school,
    payoutEmail: auth.payoutEmail,
    isEnrolled,
    isProgramEnabled: promoterProgram.enabled,
  };
}

function loadBannerDismissal(): number {
  return StorageService.getItem<number>(
    STORAGE_KEYS.PROMOTER_BANNER_DISMISSED_UNTIL,
    0,
  );
}

export function usePromoterBannerDismissal(): {
  isDismissed: boolean;
  dismiss: () => void;
} {
  const [isDismissed, setIsDismissed] = useState(
    () => loadBannerDismissal() > Date.now(),
  );
  const dismiss = useCallback(() => {
    const nextDismissal =
      Date.now() + promoterProgram.bannerDismissalDays * 24 * 60 * 60 * 1000;
    StorageService.setItem(
      STORAGE_KEYS.PROMOTER_BANNER_DISMISSED_UNTIL,
      nextDismissal,
    );
    setIsDismissed(true);
  }, []);

  return {
    isDismissed,
    dismiss,
  };
}
