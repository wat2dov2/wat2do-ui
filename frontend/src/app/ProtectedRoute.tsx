import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  fetchProfileAPI,
  getLastProfileFetchAt,
  useAuthState,
} from "@/features/auth";
import { ROLE_ADMIN, ROLE_CLUB, type Role } from "@/shared/constants/roles";
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
  // Subscribe to the same reactive auth snapshot the rest of the app reads
  // so role demotion / logout / silent-refresh updates propagate to both the
  // route gate and the TopNav button in a single render tick.
  const { isAuthenticated: authed, role, hasClub, userEmail } = useAuthState();

  // For admin routes, ensure the cached role is fresh (<5 min old) before
  // rendering admin chunks. Demoted-admin attacks / stale role leaks are
  // blocked at the UI gate.
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

  if (!authed) {
    if (userEmail !== null) {
      return <LoadingPage />;
    }
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  // Block admin UI until we have a fresh /users/me result within TTL.
  if (needsFreshRole && refreshing) {
    return <LoadingPage />;
  }

  if (requiredRole === ROLE_ADMIN && role !== "admin") {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  if (requiredRole === ROLE_CLUB && !hasClub && role !== "admin") {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  return <>{children}</>;
}
