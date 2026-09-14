/**
 * Role constants used for route protection.
 *
 * ``ROLE_ADMIN`` mirrors the backend ``users.role`` value ``"admin"``.
 *
 * ``ROLE_CLUB`` is a frontend-only route-guard token (value ``"club"``).
 * It is not a ``users.role``; access is granted when /clubs/mine
 * returns a club the user manages.
 */

export const ROLE_ADMIN = "admin" as const;
export const ROLE_CLUB = "club" as const;

/** Union of all values accepted by ``ProtectedRoute``'s ``requiredRole`` prop. */
export type Role = typeof ROLE_ADMIN | typeof ROLE_CLUB;
