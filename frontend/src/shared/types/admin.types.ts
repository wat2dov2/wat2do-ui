/**
 * Admin-related types
 */

import type { EventFormData } from "@/shared/types/event.types";

// Admin panel types
export interface EventSubmission {
  id: string;
  eventData: EventFormData;
  submittedBy: string; // user email
  submittedAt: string; // ISO timestamp
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string; // Reason provided when rejecting
}

export interface ReportedEvent {
  id: string;
  eventId: number;
  reportedBy: string;
  reportedAt: string;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
}

export interface ScrapedEvent {
  id: string;
  eventId: number;
  scrapedAt: string;
  source: string; // e.g., "web-scraper"
}

// Union type for activity feed
export type AdminActivity =
  | { type: "submission"; data: EventSubmission }
  | { type: "scraped"; data: ScrapedEvent }
  | { type: "reported"; data: ReportedEvent };
