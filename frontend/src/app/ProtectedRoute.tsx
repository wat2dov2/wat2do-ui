import { Navigate } from "react-router-dom";
import { isAuthenticated } from "@/features/auth";
import { useAppContext } from "@/contexts/AppContext";
import { ROLE_ADMIN, type Role } from "@/shared/constants/roles";
import { ROUTES } from "@/shared/constants/routes";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If set, the user must also have this role to access the route. */
  requiredRole?: Role;
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isAdmin } = useAppContext();

  if (!isAuthenticated()) {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  if (requiredRole === ROLE_ADMIN && !isAdmin) {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  // "club" role: for now all authenticated users can access club panel.
  // Gate this once a club membership model is added.

  return <>{children}</>;
}
