/**
 * Common shared types
 */

export type ViewMode = "grid" | "calendar" | "map";

// Club interface
export interface Club {
  id: number;
  club_name: string;
  categories: string[];
  club_page: string;
  ig: string | null;
  discord: string | null;
  club_type: string;
  logo_url?: string | null;
  created_by?: string | null;
  owner_email?: string | null;
  school: string;
}
