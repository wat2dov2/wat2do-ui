export type ViewMode = "grid" | "calendar" | "map";

/** Admin review state. Only approved organizations are listed publicly. */
export type OrganizationStatus = "pending" | "approved" | "rejected";

export interface Organization {
  id: number;
  organization_name: string;
  status: OrganizationStatus;
  categories: string[];
  organization_page: string;
  ig: string | null;
  discord: string | null;
  organization_type: string;
  logo_url?: string | null;
  created_by?: string | null;
  owner_email?: string | null;
  school: string;
  event_count?: number;
  latest_event_title?: string | null;
  latest_event_added_at?: string | null;
}
