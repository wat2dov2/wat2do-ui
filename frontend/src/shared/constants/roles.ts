/**
 * Role constants used for route protection.
 *
 * ``ROLE_ADMIN`` and ``ROLE_USER`` mirror the backend ``role`` column values
 * in the ``users`` table (see backend/core/constants.py).
 *
 * ``ROLE_CLUB`` is a frontend-only route-guard value.  For now every
 * authenticated user passes the "club" check; gate it once a club-
 * membership model is added on the backend.
 */

export const ROLE_ADMIN = "admin" as const;
export const ROLE_USER = "user" as const;
export const ROLE_CLUB = "club" as const;

/** Union of all values accepted by ``ProtectedRoute``'s ``requiredRole`` prop. */
export type Role = typeof ROLE_ADMIN | typeof ROLE_CLUB;
