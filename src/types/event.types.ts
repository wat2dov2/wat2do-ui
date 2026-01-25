/**
 * Event-related types
 */

export interface Event {
  id: number;
  title: string;
  category?: string; // Can be derived from club_type
  organization?: string; // Can use display_handle
  location: string;
  // Old format (for backward compatibility)
  date?: string;
  time?: string;
  dayOfWeek?: string;
  // New format
  dtstart_utc?: string; // ISO 8601 UTC datetime string
  dtend_utc?: string; // ISO 8601 UTC datetime string
  isLive?: boolean;
  food?: string[] | null;
  price?: number | null;
  requiresRegistration?: boolean; // Old format
  registration?: boolean; // New format
  addedDate?: Date; // Old format
  added_at?: string; // New format (ISO 8601)
  description?: string;
  // For timeline sorting - actual date object
  eventDate?: Date;
  imageUrl?: string; // Old format
  source_image_url?: string; // New format
  club_type?: string; // New format (WUSA, Athletics, etc.)
  school?: string;
  source_url?: string;
  ig_handle?: string | null;
  discord_handle?: string | null;
  x_handle?: string | null;
  tiktok_handle?: string | null;
  fb_handle?: string | null;
  other_handle?: string | null;
  display_handle?: string;
}

// Event submission data (matches EventFormData from SubmitEventModal)
export interface EventFormData {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: string;
  price: number;
  food: string[];
  requiresRegistration: boolean;
  organization: string;
}

// User's relationship with events
export interface UserEventState {
  savedEventIds: number[];
  registeredEventIds: number[];
}

// Form validation errors
export interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}
