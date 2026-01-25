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
  | "admin-submissions"
  | "admin-posters"
  | "settings";
export type MyEventsTab = "upcoming" | "past";

// Club interface
export interface Club {
  id: number;
  club_name: string;
  categories: string[];
  club_page: string;
  ig: string | null;
  discord: string | null;
  club_type: string;
}
