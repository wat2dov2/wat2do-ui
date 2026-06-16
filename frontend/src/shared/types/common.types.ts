/**
 * Common shared types
 */

export type ViewMode = "grid" | "calendar" | "map";

// Organization interface
export interface Organization {
  id: number;
  organization_name: string;
  categories: string[];
  organization_page: string;
  ig: string | null;
  discord: string | null;
  organization_type: string;
  logo_url?: string | null;
  created_by?: string | null;
  owner_email?: string | null;
  school: string;
}
