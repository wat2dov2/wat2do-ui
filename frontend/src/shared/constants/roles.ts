/**
 * Role constants used for route protection.
 *
 * ``ROLE_ADMIN`` mirrors the backend ``users.role`` value ``"admin"``.
 *
 * ``ROLE_ORGANIZATION`` is a frontend-only route-guard token (value ``"club"``).
 * It is not a ``users.role``; access is granted when /organizations/mine
 * returns an organization the user manages.
 */

export const ROLE_ADMIN = "admin" as const;
export const ROLE_ORGANIZATION = "club" as const;

/** Union of all values accepted by ``ProtectedRoute``'s ``requiredRole`` prop. */
export type Role = typeof ROLE_ADMIN | typeof ROLE_ORGANIZATION;
