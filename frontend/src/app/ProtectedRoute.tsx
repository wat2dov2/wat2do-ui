import { Navigate } from "react-router-dom";
import { isAuthenticated, getUserRole, getUserHasClub } from "@/features/auth";
import { ROLE_ADMIN, ROLE_CLUB, type Role } from "@/shared/constants/roles";
import { ROUTES } from "@/shared/constants/routes";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If set, the user must also have this role to access the route. */
  requiredRole?: Role;
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  if (!isAuthenticated()) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (requiredRole === ROLE_ADMIN && getUserRole() !== "admin") {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  if (requiredRole === ROLE_CLUB && !getUserHasClub() && getUserRole() !== "admin") {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  return <>{children}</>;
}
