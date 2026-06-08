/**
 * Role constants used for route protection.
 *
 * ``ROLE_ADMIN`` and ``ROLE_USER`` mirror the backend ``role`` column values
 * in the ``users`` table (see backend/core/constants.py).
 *
 * ``ROLE_ORGANIZATION`` is a frontend-only route-guard value backed by
 * /clubs/mine. A user passes this check only when an admin-assigned club
 * row lists them as its owner.
 */

export const ROLE_ADMIN = "admin" as const;
export const ROLE_ORGANIZATION = "club" as const;

/** Union of all values accepted by ``ProtectedRoute``'s ``requiredRole`` prop. */
export type Role = typeof ROLE_ADMIN | typeof ROLE_ORGANIZATION;
