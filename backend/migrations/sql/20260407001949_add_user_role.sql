-- Migration: add_user_role
-- Created: 2026-04-07T00:19:49.365747+00:00

-- Add role column to users table for RBAC (admin/user distinction).
-- Defaults to 'user'; admins are promoted manually or via a seed script.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Index for fast role lookups (e.g., listing all admins).
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
