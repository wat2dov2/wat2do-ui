import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchProfileAPI,
  getLastProfileFetchAt,
  useAuthState,
} from "@/features/auth";
import { ROLE_ADMIN, ROLE_ORGANIZATION, type Role } from "@/shared/constants/roles";
import { ROUTES } from "@/shared/constants/routes";
import { LoadingPage } from "@/shared/ui/loading-page";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If set, the user must also have this role to access the route. */
  requiredRole?: Role;
}

/**
 * Maximum age (ms) for a cached profile when gating admin routes. If the
 * last successful /users/me has returned more than this ago, we block
 * admin-chunk rendering until a fresh profile is fetched. This prevents a
 * demoted admin from continuing to see admin UI indefinitely.
 */
const ADMIN_ROLE_FRESHNESS_TTL_MS = 5 * 60 * 1000;

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const router = useRouter();
  const { isAuthenticated: authed, role, hasOrganization, userEmail } = useAuthState();

  const needsFreshRole = requiredRole === ROLE_ADMIN;
  const [refreshing, setRefreshing] = useState<boolean>(() => {
    if (!needsFreshRole) return false;
    const stale = Date.now() - getLastProfileFetchAt() > ADMIN_ROLE_FRESHNESS_TTL_MS;
    return stale;
  });

  useEffect(() => {
    if (!needsFreshRole) return;
    const stale = Date.now() - getLastProfileFetchAt() > ADMIN_ROLE_FRESHNESS_TTL_MS;
    if (!stale) return;

    let cancelled = false;
    fetchProfileAPI()
      .catch((err) => {
        console.error("ProtectedRoute: failed to refresh profile for admin gate:", err);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsFreshRole]);

  const redirectTarget = !authed && userEmail === null
    ? ROUTES.LOGIN
    : requiredRole === ROLE_ADMIN && role !== "admin"
      ? ROUTES.HOME
      : requiredRole === ROLE_ORGANIZATION && !hasOrganization && role !== "admin"
        ? ROUTES.HOME
        : null;

  useEffect(() => {
    if (redirectTarget) {
      router.replace(redirectTarget);
    }
  }, [redirectTarget, router]);

  if (redirectTarget || !authed || (needsFreshRole && refreshing)) {
    return <LoadingPage />;
  }

  return <>{children}</>;
}
