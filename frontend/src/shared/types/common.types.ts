import type { OrganizationType } from "@/shared/data/organizationTypes";

export type ViewMode = "grid" | "calendar" | "map";

export interface Organization {
  id: number;
  organization_name: string;
  categories: string[];
  /** Primary category normalized to an `organizationTypes` slug; null when unrecognized. */
  type: OrganizationType | null;
  organization_page: string;
  ig: string | null;
  discord: string | null;
  association_affiliated: boolean;
  logo_url?: string | null;
  created_by?: string | null;
  owner_email?: string | null;
  school: string;
  event_count?: number;
  latest_event_title?: string | null;
  latest_event_added_at?: string | null;
}
