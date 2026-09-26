import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { promoterProgram } from "@/shared/config/promoterProgram";

export function usePromoterState() {
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
