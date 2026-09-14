import type { ApiClubResponse } from "@/shared/generated";

export type ViewMode = "grid" | "calendar" | "map";

/** Admin review state. Only approved clubs are listed publicly. */
export type ClubStatus = ApiClubResponse["status"];

export interface Club {
  id: number;
  club_name: string;
  status: ClubStatus;
  categories: string[];
  club_page: string;
  ig: string | null;
  discord: string | null;
  club_type: string;
  logo_url?: string | null;
  created_by?: string | null;
  owner_email?: string | null;
  school: string;
  event_count?: number;
  position_count?: number;
}
