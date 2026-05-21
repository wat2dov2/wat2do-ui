/**
 * Common shared types
 */

export type ViewMode = "grid" | "calendar" | "map";
export type PageMode =
  | "events"
  | "about"
  | "myEvents"
  | "clubs"
  | "admin"
  | "marketing"
  | "admin-events"
  | "admin-clubs"
  | "admin-posters"
  | "settings";

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
}
