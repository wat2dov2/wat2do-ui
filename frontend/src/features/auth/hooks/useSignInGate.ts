import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { appendSafeReturnTo } from "@/features/auth/utils/returnTo";
import { ROUTES } from "@/shared/constants/routes";
import { useUIStore } from "@/shared/store/ui.store";

/**
 * Runs a control's action for a signed-in visitor, and sends anyone else
 * straight to the login page, which brings them back here after.
 */
export function useSignedInAction() {
  const router = useRouter();
  const { isAuthenticated } = useAuthState();
  return useCallback(
    (action: () => void) => {
      if (isAuthenticated) {
        action();
        return;
      }
      router.push(
        appendSafeReturnTo(ROUTES.LOGIN, `${window.location.pathname}${window.location.search}`),
      );
    },
    [isAuthenticated, router],
  );
}

/**
 * Whether the visitor is signed in, asking them to sign in over the page when
 * they are not. Forms call it when they are sent, so a signed-out visitor
 * fills the form first and signs in only to send it.
 */
export function useRequireSignIn() {
  const { isAuthenticated } = useAuthState();
  const promptSignIn = useUIStore((state) => state.promptSignIn);
  return useCallback(
    () => (isAuthenticated ? Promise.resolve(true) : promptSignIn()),
    [isAuthenticated, promptSignIn],
  );
}
