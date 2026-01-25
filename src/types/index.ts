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

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  priceRange: { min: string; max: string };
  dateRange: string;
  addedSince: string;
  requiresRegistration: boolean;
}

// User's relationship with events
export interface UserEventState {
  savedEventIds: number[];
  registeredEventIds: number[];
}

export type ViewMode = "grid" | "calendar" | "map";
export type FilterViewMode = "visual" | "json";
export type PageMode = "events" | "about" | "myEvents" | "clubs" | "admin" | "marketing" | "admin-events" | "admin-clubs" | "admin-submissions" | "admin-posters" | "settings";
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

// Promotion types
export interface PromotedEvent {
  eventId: number;
  package: PromotionPackage;
  startDate: string;
  endDate: string;
}

export type PromotionPackage = "featured" | "email" | "combo";

export interface PromotionPackageInfo {
  id: PromotionPackage;
  name: string;
  description: string;
  credits: number;
  duration: number; // days
  originalCredits?: number; // for showing discount
}

export const PROMOTION_PACKAGES: PromotionPackageInfo[] = [
  {
    id: "featured",
    name: "Featured Placement",
    description: "Appear at the top of search results",
    credits: 50,
    duration: 7,
  },
  {
    id: "email",
    name: "Email Blast",
    description: "Reach 1000+ interested students",
    credits: 100,
    duration: 1,
  },
  {
    id: "combo",
    name: "Combo Pack",
    description: "Featured + Email + Social Post",
    credits: 200,
    duration: 7,
    originalCredits: 250,
  },
];

export const CREDIT_PACKAGES = [
  { credits: 100, price: 5, popular: false },
  { credits: 250, price: 10, popular: true, bonus: 50 },
  { credits: 500, price: 18, popular: false, bonus: 100 },
];

// QR Code Marketing types
export interface QRCode {
  id: string;
  name: string;
  description?: string;
  destinationType: "event" | "events-list" | "custom-url";
  destinationId?: number | string; // event ID or custom URL
  filters?: FilterState; // if events-list
  createdAt: string;
  createdBy: string;
  isActive: boolean;
  imageUrl?: string; // Image/poster image (stored as data URL)
  latitude: number; // Poster location latitude
  longitude: number; // Poster location longitude
}

export interface QRCodeScan {
  id: string;
  qrCodeId: string;
  scannedAt: string;
  userId?: string;
  sessionId: string;
  conversionActions: string[];
  userAgent?: string;
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
